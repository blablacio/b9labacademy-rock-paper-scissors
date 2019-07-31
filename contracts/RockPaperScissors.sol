// Bob bets with a hash, opponent and expiry
// Alice bets plain text
// If Alice doesn't bet then Bob can reclaim after expiry
// Bob verifies his bet with his secret
// If Bob doesn't verify, then Alice can reclaim (Bob's bet is unrecoverable as penalty)

pragma solidity 0.5.8;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./Pausable.sol";

contract RockPaperScissors is Pausable {
    using SafeMath for uint;

    // Assuming that rock=0, paper=1, scissors=2:
    // - we can map index against the losing counter bet
    // - use the map to check which side wins
    // You can say that:
    // - rock = index 0 beats scissors = index 2
    // - paper = index 1 beats rock = index 0
    // - scissors = index 2 beats paper = index 1
    uint[3] choices = [2, 0, 1];
    uint public commission;
    uint public maxExpiry;

    event LogCommissionChanged(
        address indexed owner,
        uint indexed currentCommission,
        uint indexed newCommission
    );
    event LogBetPlaced(
        address indexed bettor,
        address indexed opponent,
        uint indexed amount,
        uint expiry
    );
    event LogBetCountered(address indexed opponent, uint indexed choice);
    event LogBetVerified(
        address indexed winner,
        uint indexed amount,
        uint indexed winnerChoice,
        uint loserChoice
    );
    event LogTie(uint indexed choice);
    event LogBetReclaimed(address indexed opponent, uint indexed amount);

    struct Bet {
        uint amount;
        uint expiry;
        address bettor;
        address payable opponent;
        uint counterBet;
    }
    mapping (bytes32 => Bet) public bets;

    constructor(uint _commission, uint _maxExpiry, bool _paused) Pausable(_paused) public {
        commission = _commission;
        maxExpiry = _maxExpiry;
    }

    modifier validChoice(uint choice) {
        require(choice > 0 && choice < 4, 'Choice must be rock=1, paper=2 or scissors=3');
        _;
    }

    function changeCommission(uint newCommission) public onlyOwner {
        emit LogCommissionChanged(msg.sender, commission, newCommission);

        commission = newCommission;
    }

    function generateBetHash(
        uint choice,
        bytes32 secret
    ) public view validChoice(choice) returns (bytes32) {
        return keccak256(
            abi.encode(
                choice,
                secret,
                address(this)
            )
        );
    }

    function bet(
        bytes32 betHash,
        uint expiry,
        address payable opponent
    ) external payable whenAlive whenRunning {
        require(msg.value > commission, 'You need to at least cover the commission');
        require(opponent != address(0), 'You need to provide an opponent');
        require(bets[betHash].amount == 0, 'Duplicate bet!');
        require(expiry <= maxExpiry, 'Expiry should be less than 1 day');

        bets[betHash] = Bet(
            msg.value.sub(commission),
            now.add(expiry),
            msg.sender,
            opponent,
            0
        );

        emit LogBetPlaced(msg.sender, opponent, msg.value.sub(commission), expiry);
    }

    function counter(
        bytes32 betHash,
        uint counterBet
    ) external payable validChoice(counterBet) whenAlive whenRunning {
        require(msg.sender == bets[betHash].opponent, 'You are not listed as opponent');
        require(bets[betHash].counterBet == 0, 'Bet already countered');
        require(msg.value == bets[betHash].amount.add(commission), 'You must bet the agreed amount');

        bets[betHash].opponent = msg.sender;
        bets[betHash].counterBet = counterBet;

        emit LogBetCountered(msg.sender, counterBet);
    }

    function verify(uint choice, bytes32 secret) external validChoice(choice) whenAlive whenRunning {
        bytes32 betHash = this.generateBetHash(choice, secret);
        uint counterBet = bets[betHash].counterBet;
        address payable opponent = bets[betHash].opponent;

        require(opponent != address(0), 'Invalid bet');
        require(counterBet != 0, 'Your opponent has not placed a bet yet');
        require(bets[betHash].expiry >= now, 'Bet has expired');

        uint amount = bets[betHash].amount;
        bets[betHash].amount = 0;

        if (choice == counterBet) {
            emit LogTie(choice);

            // Not very secure, right? Probably better to leave withdrawal to players?
            msg.sender.transfer(amount);
            opponent.transfer(amount);
        } else if (counterBet == choices[choice.sub(1)]) {
            emit LogBetVerified(
                opponent,
                amount.mul(2),
                counterBet,
                choice
            );

            opponent.transfer(amount.mul(2));
        } else {
            emit LogBetVerified(msg.sender, amount.mul(2), choice, counterBet);

            msg.sender.transfer(amount.mul(2));
        }
    }

    function reclaim(bytes32 betHash) external {
        uint amount = bets[betHash].amount;

        require(bets[betHash].expiry < now, 'Bet has not expired yet');
        require(amount > 0, 'Bet already verified');

        if (bets[betHash].counterBet > 0) {
            require(msg.sender == bets[betHash].opponent, 'Only opponent can claim');
        } else {
            require(msg.sender == bets[betHash].bettor, 'Only bettor can claim');
        }

        bets[betHash].amount = 0;

        emit LogBetReclaimed(msg.sender, amount);

        msg.sender.transfer(amount);
    }
}
