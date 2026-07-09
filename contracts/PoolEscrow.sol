// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Gaffer Pool back/lay escrow — trustless settlement, no operator, no house.
/// The backer and the layer each fund their side into this contract. The pot is
/// released to the winner ONLY when BOTH players co-sign the same result on-chain
/// (2-of-2) — the same 2-of-2 co-signing the P2P layer already does, now enforced
/// by the contract instead of honour. Nobody in the middle can move the money.
contract PoolEscrow {
    IERC20  public immutable token;
    address public immutable backer;
    address public immutable layer;
    uint8   public immutable outcome;   // the backed outcome: 1=HOME, 2=DRAW, 3=AWAY
    uint256 public immutable stake;      // backer's stake
    uint256 public immutable liability;  // layer's escrow = stake * (odds - 1)
    uint256 public immutable deadline;   // after this, unsettled deposits are refundable

    bool public backerFunded;
    bool public layerFunded;
    mapping(address => uint8) public agreed; // 0 = not yet agreed
    bool public settled;

    event Funded(address indexed who, uint256 amount);
    event Agreed(address indexed who, uint8 result);
    event Settled(address indexed winner, uint256 amount, uint8 result);
    event Refunded(address indexed who, uint256 amount);

    constructor(address _token, address _backer, address _layer, uint8 _outcome, uint256 _stake, uint256 _liability, uint256 _deadline) {
        require(_backer != _layer, "same party");
        require(_outcome >= 1 && _outcome <= 3, "bad outcome");
        require(_stake > 0 && _liability > 0, "bad amounts");
        require(_deadline > block.timestamp, "bad deadline");
        token = IERC20(_token);
        backer = _backer;
        layer = _layer;
        outcome = _outcome;
        stake = _stake;
        liability = _liability;
        deadline = _deadline;
    }

    /// Each player pulls their own side in (they must approve() this contract first).
    function fund() external {
        if (msg.sender == backer && !backerFunded) {
            require(token.transferFrom(msg.sender, address(this), stake), "transfer failed");
            backerFunded = true;
            emit Funded(msg.sender, stake);
        } else if (msg.sender == layer && !layerFunded) {
            require(token.transferFrom(msg.sender, address(this), liability), "transfer failed");
            layerFunded = true;
            emit Funded(msg.sender, liability);
        } else {
            revert("bad funder");
        }
    }

    /// Both players co-sign the result on-chain. When both have agreed on the SAME
    /// value, the pot auto-releases to the winner. Either can call in any order.
    function agree(uint8 result) external {
        require(backerFunded && layerFunded, "not funded");
        require(!settled, "settled");
        require(result >= 1 && result <= 3, "bad result");
        require(msg.sender == backer || msg.sender == layer, "not a player");
        agreed[msg.sender] = result;
        emit Agreed(msg.sender, result);
        if (agreed[backer] != 0 && agreed[backer] == agreed[layer]) {
            _settle(agreed[backer]);
        }
    }

    function _settle(uint8 result) internal {
        settled = true;
        uint256 pot = stake + liability;
        // Backer wins the whole pot if their outcome landed; otherwise the layer does.
        address winner = (result == outcome) ? backer : layer;
        require(token.transfer(winner, pot), "payout failed");
        emit Settled(winner, pot, result);
    }

    /// Safety valve: if the bet never settles (one side never funds, or the two
    /// never co-sign the same result) then after the deadline each funded player
    /// can reclaim their OWN deposit. No money can be locked forever.
    function refund() external {
        require(block.timestamp >= deadline, "not expired");
        require(!settled, "already settled");
        if (msg.sender == backer && backerFunded) {
            backerFunded = false;
            require(token.transfer(backer, stake), "refund failed");
            emit Refunded(backer, stake);
        } else if (msg.sender == layer && layerFunded) {
            layerFunded = false;
            require(token.transfer(layer, liability), "refund failed");
            emit Refunded(layer, liability);
        } else {
            revert("nothing to refund");
        }
    }
}
