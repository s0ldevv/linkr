import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("LaunchToken", () => {
  it("mints the fixed launch supply to the deploying factory", async () => {
    const [factory, creator] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("LaunchToken", factory);
    const token = await Token.deploy("Launch", "LCH", creator.address, "ipfs://metadata");

    assert.equal(await token.factory(), factory.address);
    assert.equal(await token.creator(), creator.address);
    assert.equal(await token.tokenURI(), "ipfs://metadata");
    assert.equal(await token.totalSupply(), ethers.parseUnits("1000000000", 18));
    assert.equal(await token.balanceOf(factory.address), await token.totalSupply());
  });

  it("has no transfer restrictions", async () => {
    const [factory, creator, pool, buyer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("LaunchToken", factory);
    const token = await Token.deploy("Launch", "LCH", creator.address, "ipfs://metadata");
    const amount = ethers.parseUnits("500000000", 18);

    await token.transfer(pool.address, amount);
    await token.connect(pool).transfer(buyer.address, amount);
    assert.equal(await token.balanceOf(buyer.address), amount);
    await token.connect(buyer).transfer(pool.address, ethers.parseUnits("1", 18));
  });
});
