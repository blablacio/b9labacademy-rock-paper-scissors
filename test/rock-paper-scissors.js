const { BN, toHex } = web3.utils;
const RockPaperScissors = artifacts.require('./RockPaperScissors.sol');

contract('RockPaperScissors', accounts => {
  let game;
  const [owner, player1, player2, player3] = accounts;

  beforeEach('setup contract for each test', async () => {
    game = await RockPaperScissors.new(10000, 600, false, { from: owner });
  });

  it('should enable only owner to change commission', async() => {
    let commission = await game.commission();

    assert.isTrue(commission.eq(new BN(10000)), 'Incorrect initial commission');

    try {
      await game.changeCommission(5000, { from: player1 });
    } catch (err) {
      assert.equal(err.reason, 'Ownable: caller is not the owner');
    }
  });

  it('should not accept bets smaller than the commission', async() => {
    const betHash = await game.generateBetHash(1, toHex('secret'));

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
    let betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(
      betHash,
      60,
      player2,
      { from: player1, value: 11000 }
    );

    const bet = await game.bets(betHash);

    assert.isTrue(bet.amount.eq(new BN(1000)));
    assert.strictEqual(bet.opponent, player2);

    try {
      await game.bet(
        betHash,
        86400,
        player2,
        { from: player1, value: 11000 }
      );
    } catch(err) {
      assert.strictEqual(err.reason, 'Duplicate bet!');
    }

    betHash = await game.generateBetHash(1, toHex('secret2'));

    try {
      await game.bet(
        betHash,
        86500,
        player2,
        { from: player1, value: 11000 }
      );
    } catch(err) {
      assert.strictEqual(err.reason, 'Expiry should be less than 1 day');
    }

    betHash = await game.generateBetHash(1, toHex('secret3'));

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
    let betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    try {
      await game.counter(betHash, 1, { from: player3, value: 11000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'You are not listed as opponent');
    }

    try {
      await game.counter(betHash, 1, { from: player2, value: 10000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'You must bet the agreed amount');
    }

    await game.counter(betHash, 1, { from: player2, value: 11000 });
    
    const bet = await game.bets(betHash);

    assert.strictEqual(bet.opponent, player2);
    assert.isTrue(bet.counterBet.eq(new BN(1)));

    try {
      await game.counter(betHash, 1, { from: player2, value: 11000 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet already countered');
    }
  });

  it('should handle bet verification correctly', async() => {
    const betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    try {
      await game.verify(1, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Your opponent has not placed a bet yet');
    }

    try {
      await game.verify(2, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Invalid bet');
    }

    await game.counter(betHash, 1, { from: player2, value: 11000 });

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
      await game.verify(1, toHex('secret'), { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet has expired');
    }
  });

  it('should handle a tie correctly', async() => {
    const betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.bets(betHash);
    const player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    const player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(bet.amount.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.opponent, player2);

    const counter = await game.counter(betHash, 1, { from: player2, value: 11000 });
    const counterTx = await web3.eth.getTransaction(counter.tx);
    const verify = await game.verify(1, toHex('secret'), { from: player1 });
    const verifyTx = await web3.eth.getTransaction(verify.tx);

    const player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    const player2EndingBalance = new BN(await web3.eth.getBalance(player2));
    bet = await game.bets(betHash);

    assert.isTrue(bet.amount.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .sub(new BN(verify.receipt.gasUsed).mul(new BN(verifyTx.gasPrice)))
      .add(new BN(1000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .sub(await game.commission())
      .sub(new BN(counter.receipt.gasUsed).mul(new BN(counterTx.gasPrice)))
      .eq(player2EndingBalance));
  });

  it('should handle the bettor winning correctly', async() => {
    const betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.bets(betHash);
    const player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    const player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(bet.amount.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.opponent, player2);

    const counter = await game.counter(betHash, 3, { from: player2, value: 11000 });
    const counterTx = await web3.eth.getTransaction(counter.tx);
    const verify = await game.verify(1, toHex('secret'), { from: player1 });
    const verifyTx = await web3.eth.getTransaction(verify.tx);

    const player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    const player2EndingBalance = new BN(await web3.eth.getBalance(player2));
    bet = await game.bets(betHash);

    assert.isTrue(bet.amount.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .sub(new BN(verify.receipt.gasUsed).mul(new BN(verifyTx.gasPrice)))
      .add(new BN(2000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .sub(new BN(11000))
      .sub(new BN(counter.receipt.gasUsed).mul(new BN(counterTx.gasPrice)))
      .eq(player2EndingBalance));
  });

  it('should handle the opponent winning correctly', async() => {
    const betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });

    let bet = await game.bets(betHash);
    const player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    const player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(bet.amount.add(await game.commission()).eq(new BN(11000)));
    assert.strictEqual(bet.opponent, player2);

    const counter = await game.counter(betHash, 2, { from: player2, value: 11000 });
    const counterTx = await web3.eth.getTransaction(counter.tx);
    const verify = await game.verify(1, toHex('secret'), { from: player1 });
    const verifyTx = await web3.eth.getTransaction(verify.tx);

    const player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    const player2EndingBalance = new BN(await web3.eth.getBalance(player2));
    bet = await game.bets(betHash);

    assert.isTrue(bet.amount.eq(new BN(0)));
    assert.isTrue(
      player1StartingBalance
      .sub(new BN(verify.receipt.gasUsed).mul(new BN(verifyTx.gasPrice)))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .sub(new BN(11000))
      .sub(new BN(counter.receipt.gasUsed).mul(new BN(counterTx.gasPrice)))
      .add(new BN(2000))
      .eq(player2EndingBalance));
  });

  it('should handle claims correctly', async() => {
    let betHash = await game.generateBetHash(1, toHex('secret'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    
    try {
      await game.reclaim(betHash, { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet has not expired yet');
    }

    await game.counter(betHash, 2, { from: player2, value: 11000 });
    await game.verify(1, toHex('secret'), { from: player1 });
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
      await game.reclaim(betHash, { from: player2 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Bet already verified');
    }

    betHash = await game.generateBetHash(1, toHex('secret2'));

    await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    await game.counter(betHash, 2, { from: player2, value: 11000 });
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
      await game.reclaim(betHash, { from: player1 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Only opponent can claim');
    }

    betHash = await game.generateBetHash(1, toHex('secret3'));

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
      await game.reclaim(betHash, { from: player2 });
    } catch(err) {
      assert.strictEqual(err.reason, 'Only bettor can claim');
    }

    betHash = await game.generateBetHash(1, toHex('secret4'));
    let player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    let player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    let bet = await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    let betTx = await web3.eth.getTransaction(bet.tx);
    const counter = await game.counter(betHash, 2, { from: player2, value: 11000 });
    const counterTx = await web3.eth.getTransaction(counter.tx);

    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [70],
        id: 0
      },
      () => {}
    );
    let reclaim = await game.reclaim(betHash, { from: player2 });
    let reclaimTx = await web3.eth.getTransaction(reclaim.tx);

    let player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    let player2EndingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(
      player1StartingBalance
      .sub(new BN(11000))
      .sub(new BN(bet.receipt.gasUsed).mul(new BN(betTx.gasPrice)))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .sub(new BN(11000))
      .sub(new BN(counter.receipt.gasUsed).mul(new BN(counterTx.gasPrice)))
      .sub(new BN(reclaim.receipt.gasUsed).mul(new BN(reclaimTx.gasPrice)))
      .add(new BN(1000))
      .eq(player2EndingBalance)
    );

    betHash = await game.generateBetHash(1, toHex('secret5'));
    player1StartingBalance = new BN(await web3.eth.getBalance(player1));
    player2StartingBalance = new BN(await web3.eth.getBalance(player2));

    bet = await game.bet(betHash, 60, player2, { from: player1, value: 11000 });
    betTx = await web3.eth.getTransaction(bet.tx);

    await web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [70],
        id: 0
      },
      () => {}
    );
    reclaim = await game.reclaim(betHash, { from: player1 });
    reclaimTx = await web3.eth.getTransaction(reclaim.tx);

    player1EndingBalance = new BN(await web3.eth.getBalance(player1));
    player2EndingBalance = new BN(await web3.eth.getBalance(player2));

    assert.isTrue(
      player1StartingBalance
      .sub(new BN(11000))
      .sub(new BN(bet.receipt.gasUsed).mul(new BN(betTx.gasPrice)))
      .sub(new BN(reclaim.receipt.gasUsed).mul(new BN(reclaimTx.gasPrice)))
      .add(new BN(1000))
      .eq(player1EndingBalance)
    );
    assert.isTrue(
      player2StartingBalance
      .eq(player2EndingBalance)
    );
  });
});
