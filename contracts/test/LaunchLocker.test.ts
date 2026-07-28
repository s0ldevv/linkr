import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { assertCustomError, assertReverts } from "../test-support/helpers.js";

const { ethers } = await network.create();

describe("LaunchLocker", () => {
  async function fixture() {
    const [admin, factorySigner, other, creator, treasury] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const token0 = await Token.deploy("Token0", "T0");
    const token1 = await Token.deploy("Token1", "T1");
    const V3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
    const v3Factory = await V3Factory.deploy();
    const Manager = await ethers.getContractFactory("MockNonfungiblePositionManager");
    const manager = await Manager.deploy(await v3Factory.getAddress(), await token1.getAddress());
    const Locker = await ethers.getContractFactory("LaunchLocker");
    const locker = await Locker.deploy(await manager.getAddress(), treasury.address, admin.address);
    return { admin, factorySigner, other, creator, treasury, token0, token1, manager, locker };
  }

  it("restricts factory initialization to admin", async () => {
    const { admin, factorySigner, other, locker } = await fixture();
    await assertCustomError(locker.connect(other).setFactory(factorySigner.address), locker, "OnlyAdmin");
    await assertCustomError(locker.connect(admin).setFactory(ethers.ZeroAddress), locker, "ZeroAddress");
    await locker.connect(admin).setFactory(factorySigner.address);
    await assertCustomError(locker.connect(admin).setFactory(other.address), locker, "FactoryAlreadySet");
  });

  it("only accepts position NFTs during a factory mint flow", async () => {
    const { admin, factorySigner, other, token0, token1, manager, locker } = await fixture();
    await locker.connect(admin).setFactory(factorySigner.address);
    const tokenId = await manager.mintExternal.staticCall(other.address, await token0.getAddress(), await token1.getAddress());
    await manager.mintExternal(other.address, await token0.getAddress(), await token1.getAddress());

    await assertCustomError(
      manager.connect(other)["safeTransferFrom(address,address,uint256)"](other.address, await locker.getAddress(), tokenId),
      locker,
      "UnexpectedNft",
    );

    await locker.connect(factorySigner).beginMint();
    const flowTokenId = await manager.mintExternal.staticCall(await locker.getAddress(), await token0.getAddress(), await token1.getAddress());
    await manager.mintExternal(await locker.getAddress(), await token0.getAddress(), await token1.getAddress());
    await locker
      .connect(factorySigner)
      .register(flowTokenId, other.address, await token0.getAddress(), await token1.getAddress(), 8_000);
    assert.equal(await manager.ownerOf(flowTokenId), await locker.getAddress());
  });

  it("collects and splits fees without exposing NFT withdrawal", async () => {
    const { admin, factorySigner, creator, treasury, token0, token1, manager, locker } = await fixture();
    await locker.connect(admin).setFactory(factorySigner.address);
    await locker.connect(factorySigner).beginMint();
    const tokenId = await manager.mintExternal.staticCall(await locker.getAddress(), await token0.getAddress(), await token1.getAddress());
    await manager.mintExternal(await locker.getAddress(), await token0.getAddress(), await token1.getAddress());
    await locker
      .connect(factorySigner)
      .register(tokenId, creator.address, await token0.getAddress(), await token1.getAddress(), 8_000);
    await assertCustomError(
      locker.connect(factorySigner).register(tokenId, creator.address, await token0.getAddress(), await token1.getAddress(), 8_000),
      locker,
      "PositionAlreadyRegistered",
    );

    await token0.mint(await manager.getAddress(), 1000);
    await token1.mint(await manager.getAddress(), 500);
    await manager.setCollectAmounts(tokenId, 1000, 500);
    await locker.collect(tokenId);

    assert.equal(await locker.claimable(creator.address, await token0.getAddress()), 800n);
    assert.equal(await locker.claimable(treasury.address, await token0.getAddress()), 200n);
    await locker.connect(creator).claim(await token0.getAddress());
    assert.equal(await token0.balanceOf(creator.address), 800n);

    await assertReverts(manager.transferFrom(await locker.getAddress(), creator.address, tokenId));
  });
});
