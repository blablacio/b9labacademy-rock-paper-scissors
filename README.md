# B9lab Academy Rock-Paper-Scissors game

Rock-Paper-Scissors is a smart contract that implements the classic game:
- First player creates a bet by submitting his hashed choice and secret along with some ether
- Second player submits his clear choice
- First player reveals his choice
- Winner is awarded the pot, or if a tie, the bets are returned to players
- In cases where second player doesn't counter the bet, first player can reclaim after expiry
- In cases where first player doesn't reveal his choice before expiry, the second player can reclaim his bet (first player is penalized)

## Installation

You need a recent version of [Docker](https://docs.docker.com/install/) and [Docker Compose](https://docs.docker.com/compose/install/)

## Usage

```
docker-compose build
docker-compose up -d
```

You can then check tests output:
```
docker logs -f rock-paper-scissors-tests
```