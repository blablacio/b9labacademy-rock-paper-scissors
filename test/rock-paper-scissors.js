const { BN, toHex } = web3.utils;
const RockPaperScissors = artifacts.require('./RockPaperScissors.sol');

contract('RockPaperScissors', accounts => {
  let game;
  const [owner, player1, player2, player3] = accounts;
  const moves = {
    None: 0,
    Rock: 1,
    Paper: 2,
    Scissors: 3
  };

  beforeEach('setup contract for each test', async () => {
    game = await RockPaperScissors.new(10000, 600, false, { from: owner });
  });

  it('should enable only owner to change commission', async() => {
    let commission = await game.commission();

    assert.isTrue(commission.eq(new BN(10000)));

    try {
      await game.changeCommission(5000, { from: player1 });
    } catch(err) {
      assert.equal(err.reason, 'Ownable: caller is not the owner');
    }
  });

  it('should not accept bets smaller than the commission', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    try {
      await game.bet(
        betHash,
        60,
        player2,
        { from: player1, value: 10000 }
      );
    } catch(err) {
      assert.equal(err.reason, 'You need to at least cover the commission');
    }
  });

  it('should handle bets correctly', async() => {
    let betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(
      betHash,
      60,
      player2,
      { from: player1, value: 11000 }
    );

    const bet = await game.rounds(betHash);

    assert.isTrue(bet.bet.eq(new BN(1000)));
    assert.strictEqual(bet.player2, player2);

    try {
      await game.bet(
        betHash,
        600,
        player2,
        { from: player1, value: 11000 }
      );
    } catch(err) {
      assert.strictEqual(err.reason, 'Duplicate bet!');
    }

    betHash = await game.generateBetHash(moves.Rock, toHex('secret2'), player1);

    try {
      await game.bet(
        betHash,
        700,
        player2,
        { from: player1, value: 11000 }
      );
    } catch(err) {
      assert.strictEqual(err.reason, 'Expiry should be less than maxExpiry');
    }

    betHash = await game.generateBetHash(1, toHex('secret3'), player1);

    try {
      await game.bet(
        betHash,
        600,
        '0x0000000000000000000000000000000000000000',
        { from: player1, value: 11000 }
      );
    } catch(err) {
      assert.strictEqual(err.reason, 'You need to provide an opponent');
    }
  });

  it('should handle counter bet correctly', async() => {
    let betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    try {
      await game.counter(betHash, moves.Rock, { from: player3, value: 11000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'You are not listed as opponent');
    }

    try {
      await game.counter(betHash, moves.Rock, { from: player2, value: 10000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'You must bet the agreed amount');
    }

    await game.counter(betHash, moves.Rock, { from: player2, value: 11000 });
    
    const bet = await game.rounds(betHash);

    assert.strictEqual(bet.player2, player2);
    assert.isTrue(bet.player2Move.eq(new BN(1)));

    try {
      await game.counter(betHash, moves.Rock, { from: player2, value: 11000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet already countered');
    }
  });

  it('should handle bet verification correctly', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    try {
      await game.verify(moves.Rock, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Your opponent has not placed a bet yet');
    }

    try {
      await game.verify(moves.Paper, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Invalid or expired bet');
    }

    await game.counter(betHash, moves.Rock, { from: player2, value: 11000 });

    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [670],
        id: 0
      },
      () => {}
    );

    try {
      await game.verify(moves.Rock, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Invalid or expired bet');
    }
  });

  it('should handle a tie correctly', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.rounds(betHash);
    let player1StartingBalance = await game.balances(player1);
    let player2StartingBalance = await game.balances(player2);

    assert.isTrue(bet.bet.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.player2, player2);

    await game.counter(betHash, moves.Rock, { from: player2, value: 11000 });
    await game.verify(moves.Rock, toHex('secret'), { from: player1 });

    let player1EndingBalance = await game.balances(player1);
    let player2EndingBalance = await game.balances(player2);
    bet = await game.rounds(betHash);

    assert.isTrue(bet.bet.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .add(new BN(1000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .add(new BN(1000))
      .eq(player2EndingBalance)
    );
  });

  it('should handle the player1 winning correctly', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.rounds(betHash);
    const player1StartingBalance = await game.balances(player1);
    const player2StartingBalance = await game.balances(player2);

    assert.isTrue(bet.bet.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.player2, player2);

    await game.counter(betHash, moves.Scissors, { from: player2, value: 11000 });
    await game.verify(moves.Rock, toHex('secret'), { from: player1 });

    const player1EndingBalance = await game.balances(player1);
    const player2EndingBalance = await game.balances(player2);
    bet = await game.rounds(betHash);

    assert.isTrue(bet.bet.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .add(new BN(2000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .eq(player2EndingBalance));
  });

  it('should handle the player2 winning correctly', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.rounds(betHash);
    const player1StartingBalance = await game.balances(player1);
    const player2StartingBalance = await game.balances(player2);

    assert.isTrue(bet.bet.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.player2, player2);

    await game.counter(betHash, moves.Paper, { from: player2, value: 11000 });
    await game.verify(moves.Rock, toHex('secret'), { from: player1 });

    const player1EndingBalance = await game.balances(player1);
    const player2EndingBalance = await game.balances(player2);
    bet = await game.rounds(betHash);

    assert.isTrue(bet.bet.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .add(new BN(2000))
      .eq(player2EndingBalance));
  });

  it('should handle claims correctly', async() => {
    let betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    
    try {
      await game.player1Reclaim(moves.Rock, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet has not expired yet');
    }

    await game.counter(betHash, moves.Paper, { from: player2, value: 11000 });
    await game.verify(moves.Rock, toHex('secret'), { from: player1 });
    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [670],
        id: 0
      },
      () => {}
    );

    try {
      await game.player2Reclaim(betHash, { from: player2 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet already verified');
    }

    betHash = await game.generateBetHash(moves.Rock, toHex('secret2'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    await game.counter(betHash, moves.Paper, { from: player2, value: 11000 });
    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [70],
        id: 0
      },
      () => {}
    );
    
    try {
      await game.player2Reclaim(betHash, { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Only opponent can claim');
    }

    betHash = await game.generateBetHash(moves.Rock, toHex('secret3'), player1);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [70],
        id: 0
      },
      () => {}
    );
    
    try {
      await game.player1Reclaim(moves.Rock, toHex('secret3'), { from: player2 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Unauthorized claim or bet verified');
    }

    betHash = await game.generateBetHash(moves.Rock, toHex('secret4'), player1);
    let player1StartingBalance = await game.balances(player1);
    let player2StartingBalance = await game.balances(player2);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    await game.counter(betHash, moves.Paper, { from: player2, value: 11000 });

    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [670],
        id: 0
      },
      () => {}
    );
    await game.player2Reclaim(betHash, { from: player2 });

    let player1EndingBalance = await game.balances(player1);
    let player2EndingBalance = await game.balances(player2);

    assert.isTrue(
      player1StartingBalance
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .add(new BN(2000))
      .eq(player2EndingBalance)
    );

    betHash = await game.generateBetHash(moves.Rock, toHex('secret5'), player1);
    player1StartingBalance = await game.balances(player1);
    player2StartingBalance = await game.balances(player2);

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [70],
        id: 0
      },
      () => {}
    );
    await game.player1Reclaim(moves.Rock, toHex('secret5'), { from: player1 });

    player1EndingBalance = await game.balances(player1);
    player2EndingBalance = await game.balances(player2);

    assert.isTrue(
      player1StartingBalance
      .add(new BN(1000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .eq(player2EndingBalance)
    );
  });

  it('should handle withdrawals properly', async() => {
    const betHash = await game.generateBetHash(moves.Rock, toHex('secret'), player1);

    const player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    const player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    const bet = await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    const betTx = await web3.eth.getTransaction(bet.tx);

    const counter = await game.counter(betHash, moves.Paper, { from: player2, value: 11000 });
    const counterTx = await web3.eth.getTransaction(counter.tx);

    const verify = await game.verify(moves.Rock, toHex('secret'), { from: player1 });
    const verifyTx = await web3.eth.getTransaction(verify.tx);
    
    const player1GameBalance = await game.balances(player1);
    let player2GameBalance = await game.balances(player2);

    assert.isTrue(player1GameBalance.eq(new BN(0)));
    assert.isTrue(player2GameBalance.eq(new BN(2000)));

    const withdraw = await game.withdraw(2000, { from: player2 });
    const withdrawTx = await web3.eth.getTransaction(withdraw.tx);

    const player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    const player2EndingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(
      player1StartingBalance
      .sub(new BN(11000))
      .sub(new BN(bet.receipt.gasUsed).mul(new BN(betTx.gasPrice)))
      .sub(new BN(verify.receipt.gasUsed).mul(new BN(verifyTx.gasPrice)))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .sub(new BN(11000))
      .sub(new BN(counter.receipt.gasUsed).mul(new BN(counterTx.gasPrice)))
      .sub(new BN(withdraw.receipt.gasUsed).mul(new BN(withdrawTx.gasPrice)))
      .add(player2GameBalance)
      .eq(player2EndingBalance)
    );

    try {
      await game.withdraw(10000, { from: player2 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Insufficient balance');
    }

    player2GameBalance = await game.balances(player2);
    
    assert.isTrue(player2GameBalance.eq(new BN(0)));
  });
});
