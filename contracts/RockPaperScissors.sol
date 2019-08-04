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

    enum Moves { None, Rock, Paper, Scissors }
    // Maps possible moves to the winning counter move
    Moves[4] winningMoves = [Moves.None, Moves.Paper, Moves.Scissors, Moves.Rock];
    uint public commission;
    uint public maxExpiry;

    event LogCommissionChanged(
        address indexed owner,
        uint indexed currentCommission,
        uint indexed newCommission
    );
    event LogBetPlaced(
        address indexed player1,
        address indexed player2,
        uint indexed bet,
        uint expiry
    );
    event LogBetCountered(address indexed player2, Moves indexed move);
    event LogBetVerified(
        address indexed winner,
        uint indexed bet,
        Moves indexed winnerMove,
        Moves loserMove
    );
    event LogTie(Moves indexed move);
    event LogBetReclaimed(address indexed player, uint indexed bet);
    event LogWithdrawalRequested(address indexed player, uint indexed amount);

    struct Game {
        uint bet;
        uint expiry;
        address payable player2;
        Moves player2Move;
    }
    // Maps first player's move + secret + address hash to a single game round
    mapping (bytes32 => Game) public rounds;
    // Maps user addresses to balances
    mapping (address => uint) public balances;

    constructor(uint _commission, uint _maxExpiry, bool _paused) Pausable(_paused) public {
        commission = _commission;
        maxExpiry = _maxExpiry;
    }

    modifier validMove(Moves move) {
        require(uint(move) > 0 && uint(move) < 4, 'Choice must be rock=1, paper=2 or scissors=3');
        _;
    }

    function changeCommission(uint newCommission) public onlyOwner {
        emit LogCommissionChanged(msg.sender, commission, newCommission);

        commission = newCommission;
    }

    function generateBetHash(
        Moves move,
        bytes32 secret,
        address player
    ) public view validMove(move) returns (bytes32) {
        return keccak256(
            abi.encode(
                move,
                secret,
                player,
                address(this)
            )
        );
    }

    function bet(
        bytes32 betHash,
        uint expiry,
        address payable player2
    ) external payable whenAlive whenRunning {
        require(msg.value > commission, 'You need to at least cover the commission');
        require(player2 != address(0), 'You need to provide an opponent');
        require(rounds[betHash].expiry == 0, 'Duplicate bet!');
        require(expiry <= maxExpiry, 'Expiry should be less than maxExpiry');

        rounds[betHash] = Game(
            msg.value.sub(commission),
            now.add(expiry),
            player2,
            Moves.None
        );

        emit LogBetPlaced(msg.sender, player2, msg.value.sub(commission), expiry);
    }

    function counter(
        bytes32 betHash,
        Moves player2Move
    ) external payable validMove(player2Move) whenAlive whenRunning {
        require(msg.sender == rounds[betHash].player2, 'You are not listed as opponent');
        require(rounds[betHash].expiry >= now, 'Bet expired');
        require(rounds[betHash].player2Move == Moves.None, 'Bet already countered');
        require(msg.value == rounds[betHash].bet.add(commission), 'You must bet the agreed amount');

        rounds[betHash].player2Move = player2Move;
        rounds[betHash].expiry = rounds[betHash].expiry.add(maxExpiry);

        emit LogBetCountered(msg.sender, player2Move);
    }

    function verify(
        Moves player1Move,
        bytes32 secret
    ) external validMove(player1Move) whenAlive whenRunning {
        bytes32 betHash = this.generateBetHash(player1Move, secret, msg.sender);
        require(rounds[betHash].expiry >= now, 'Invalid or expired bet');

        uint betAmount = rounds[betHash].bet;
        require(betAmount > 0, 'Bet already claimed');

        Moves player2Move = rounds[betHash].player2Move;
        require(player2Move > Moves.None, 'Your opponent has not placed a bet yet');

        address payable player2 = rounds[betHash].player2;

        rounds[betHash].bet = 0;
        rounds[betHash].player2 = address(0);
        rounds[betHash].player2Move = Moves.None;

        if (player1Move == player2Move) {
            balances[msg.sender] = balances[msg.sender].add(betAmount);
            balances[player2] = balances[player2].add(betAmount);

            emit LogTie(player2Move);
        } else if (player2Move == winningMoves[uint(player1Move)]) {
            balances[player2] = balances[player2].add(betAmount.mul(2));

            emit LogBetVerified(
                player2,
                betAmount.mul(2),
                player2Move,
                player1Move
            );
        } else {
            emit LogBetVerified(msg.sender, betAmount.mul(2), player1Move, player2Move);

            balances[msg.sender] = balances[msg.sender].add(betAmount.mul(2));
        }
    }

    function player1Reclaim(Moves move, bytes32 secret) external {
        bytes32 betHash = this.generateBetHash(move, secret, msg.sender);
        require(rounds[betHash].expiry < now, 'Bet has not expired yet');
        require(rounds[betHash].player2Move == Moves.None, 'Cannot reclaim countered bet');

        uint betAmount = rounds[betHash].bet;
        require(betAmount > 0, 'Unauthorized claim or bet verified');

        rounds[betHash].bet = 0;
        rounds[betHash].player2 = address(0);
        rounds[betHash].player2Move = Moves.None;

        balances[msg.sender] = balances[msg.sender].add(betAmount);

        emit LogBetReclaimed(msg.sender, betAmount);
    }

    function player2Reclaim(bytes32 betHash) external {
        uint betAmount = rounds[betHash].bet;

        require(betAmount > 0, 'Bet already verified');
        require(msg.sender == rounds[betHash].player2, 'Only opponent can claim');
        require(rounds[betHash].expiry < now, 'Bet has not expired yet');


        rounds[betHash].bet = 0;
        rounds[betHash].player2 = address(0);
        rounds[betHash].player2Move = Moves.None;

        balances[msg.sender] = balances[msg.sender].add(betAmount);

        emit LogBetReclaimed(msg.sender, betAmount);
    }

    function withdraw(uint amount) external {
        require(balances[msg.sender] >= amount, 'Insufficient balance');

        balances[msg.sender] = balances[msg.sender].sub(amount);

        emit LogWithdrawalRequested(msg.sender, amount);

        msg.sender.transfer(amount);
    }
}
