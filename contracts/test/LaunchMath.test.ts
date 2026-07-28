import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { assertRevertReason } from "../test-support/helpers.js";

const { ethers } = await network.create();

describe("TickMath", () => {
  it("returns canonical sqrt ratios at important ticks", async () => {
    const Harness = await ethers.getContractFactory("TickMathHarness");
    const tickMath = await Harness.deploy();

    assert.equal(await tickMath.minTick(), -887272n);
    assert.equal(await tickMath.maxTick(), 887272n);
    assert.equal(await tickMath.minSqrtRatio(), 4295128739n);
    assert.equal(await tickMath.maxSqrtRatio(), 1461446703485210103287273052203988822378723970342n);
    assert.equal(await tickMath.getSqrtRatioAtTick(0), 79228162514264337593543950336n);
    assert.equal(await tickMath.getSqrtRatioAtTick(-887272), 4295128739n);
    assert.equal(await tickMath.getSqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342n);
  });

  it("reverts outside the supported tick range", async () => {
    const Harness = await ethers.getContractFactory("TickMathHarness");
    const tickMath = await Harness.deploy();

    await assertRevertReason(tickMath.getSqrtRatioAtTick(887273), "T");
    await assertRevertReason(tickMath.getSqrtRatioAtTick(-887273), "T");
  });

  it("binds CREATE2 salts to creators conceptually", async () => {
    const [a, b] = await ethers.getSigners();
    assert.notEqual(
      ethers.solidityPackedKeccak256(["address", "bytes32"], [a.address, ethers.ZeroHash]),
      ethers.solidityPackedKeccak256(["address", "bytes32"], [b.address, ethers.ZeroHash]),
    );
  });
});
