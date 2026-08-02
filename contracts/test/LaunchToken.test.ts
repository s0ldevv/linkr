import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { assertCustomError } from "../test-support/helpers.js";

const { ethers } = await network.create();

const socials = {
  twitter: "https://x.com/linkrcash",
  telegram: "https://t.me/linkr",
  discord: "",
  website: "https://linkr.cash",
  farcaster: "",
};

describe("LaunchToken", () => {
  it("mints the fixed launch supply to the deploying factory", async () => {
    const [factory, creator] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("LaunchToken", factory);
    const token = await Token.deploy(
      "Launch",
      "LCH",
      creator.address,
      "ipfs://metadata",
      "ipfs://logo",
      "Launch description",
      socials,
    );

    assert.equal(await token.factory(), factory.address);
    assert.equal(await token.creator(), creator.address);
    assert.equal(await token.tokenURI(), "ipfs://metadata");
    assert.equal(await token.logo(), "ipfs://logo");
    assert.equal(await token.description(), "Launch description");
    const socialValues = await token.socials();
    assert.deepEqual([...socialValues], [
      socials.twitter,
      socials.telegram,
      socials.discord,
      socials.website,
      socials.farcaster,
    ]);
    const info = await token.getTokenInfo();
    assert.equal(info.tokenDeployer, creator.address);
    assert.equal(info.tokenLogo, "ipfs://logo");
    assert.equal(info.tokenDescription, "Launch description");
    assert.deepEqual([...info.tokenSocials], [
      socials.twitter,
      socials.telegram,
      socials.discord,
      socials.website,
      socials.farcaster,
    ]);
    assert.equal(await token.totalSupply(), ethers.parseUnits("1000000000", 18));
    assert.equal(await token.balanceOf(factory.address), await token.totalSupply());
  });

  it("rejects a zero creator", async () => {
    const [factory] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("LaunchToken", factory);

    await assertCustomError(
      Token.deploy("Launch", "LCH", ethers.ZeroAddress, "ipfs://metadata", "ipfs://logo", "", socials),
      Token,
      "ZeroAddress",
    );
  });

  it("has no transfer restrictions", async () => {
    const [factory, creator, pool, buyer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("LaunchToken", factory);
    const token = await Token.deploy("Launch", "LCH", creator.address, "ipfs://metadata", "ipfs://logo", "", socials);
    const amount = ethers.parseUnits("500000000", 18);

    await token.transfer(pool.address, amount);
    await token.connect(pool).transfer(buyer.address, amount);
    assert.equal(await token.balanceOf(buyer.address), amount);
    await token.connect(buyer).transfer(pool.address, ethers.parseUnits("1", 18));
  });
});
