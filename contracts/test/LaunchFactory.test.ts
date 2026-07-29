import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { assertCustomError } from "../test-support/helpers.js";

const { ethers } = await network.create();

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    name: "Sherwood",
    symbol: "WOOD",
    metadataURI: "ipfs://metadata",
    initialBuyWeth: 0n,
    salt: ethers.id(`salt-${Math.random()}`),
    ...overrides,
  };
}

async function deploySystem(weth?: string, treasuryOverride?: string, launchFee = 0n) {
  const [deployer, creator, treasury] = await ethers.getSigners();
  if (!weth) {
    const WETH = await ethers.getContractFactory("MockWETH");
    const deployedWeth = await WETH.deploy();
    weth = await deployedWeth.getAddress();
  }
  const V3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const v3Factory = await V3Factory.deploy();
  const Manager = await ethers.getContractFactory("MockNonfungiblePositionManager");
  const manager = await Manager.deploy(await v3Factory.getAddress(), weth);
  const Locker = await ethers.getContractFactory("LaunchLocker");
  const locker = await Locker.deploy(await manager.getAddress(), treasuryOverride ?? treasury.address, deployer.address);
  const Factory = await ethers.getContractFactory("LaunchFactory");
  const factory = await Factory.deploy(
    weth,
    await v3Factory.getAddress(),
    await manager.getAddress(),
    await locker.getAddress(),
    treasuryOverride ?? treasury.address,
    launchFee,
  );
  await locker.setFactory(await factory.getAddress());
  const TickMath = await ethers.getContractFactory("TickMathHarness");
  const tickMath = await TickMath.deploy();
  return { deployer, creator, treasury, v3Factory, manager, locker, factory, tickMath, wethAddress: weth };
}

async function launch(factory: any, creator: any, params = baseParams()) {
  const fee = await factory.launchFee();
  const graduation = await factory.GRADUATION_WETH();
  const predicted = await factory.predictTokenAddress(params, creator.address);
  const tx = await factory.connect(creator).launch(params, { value: fee + (params.initialBuyWeth as bigint) });
  await tx.wait();
  return { predicted, graduation };
}

async function deploySystemWithMockWeth() {
  const WETH = await ethers.getContractFactory("MockWETH");
  const weth = await WETH.deploy();
  const system = await deploySystem(await weth.getAddress());
  return { ...system, weth };
}

function addressLt(a: string, b: string) {
  return BigInt(a) < BigInt(b);
}

async function paramsForOrientation(factory: any, creator: any, weth: string, wantLaunchTokenIsToken0: boolean, label: string, overrides = {}) {
  for (let i = 0; i < 200; i++) {
    const params = baseParams({ ...overrides, salt: ethers.id(`${label}-${i}`) });
    const predicted = await factory.predictTokenAddress(params, creator.address);
    if (addressLt(predicted, weth) === wantLaunchTokenIsToken0) return { params, predicted };
  }
  throw new Error(`Unable to find ${label} salt for requested token orientation`);
}

async function precreatePool(v3Factory: any, token: string, weth: string) {
  const pool = await v3Factory.createPool.staticCall(token, weth, 10_000);
  await v3Factory.createPool(token, weth, 10_000);
  return ethers.getContractAt("MockUniswapV3Pool", pool);
}

describe("LaunchFactory", () => {
  it("rejects zero constructor addresses", async () => {
    const [deployer, treasury] = await ethers.getSigners();
    const V3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
    const v3Factory = await V3Factory.deploy();
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    const Manager = await ethers.getContractFactory("MockNonfungiblePositionManager");
    const manager = await Manager.deploy(await v3Factory.getAddress(), await weth.getAddress());
    const Locker = await ethers.getContractFactory("LaunchLocker");
    const locker = await Locker.deploy(await manager.getAddress(), treasury.address, deployer.address);
    const Factory = await ethers.getContractFactory("LaunchFactory");

    await assertCustomError(
      Factory.deploy(ethers.ZeroAddress, await v3Factory.getAddress(), await manager.getAddress(), await locker.getAddress(), treasury.address, 0),
      Factory,
      "ZeroAddress",
    );
  });

  it("rejects mismatched position manager or locker dependencies", async () => {
    const [deployer, treasury] = await ethers.getSigners();
    const V3Factory = await ethers.getContractFactory("MockUniswapV3Factory");
    const v3Factory = await V3Factory.deploy();
    const otherV3Factory = await V3Factory.deploy();
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    const wrongWeth = await WETH.deploy();
    const Manager = await ethers.getContractFactory("MockNonfungiblePositionManager");
    const manager = await Manager.deploy(await v3Factory.getAddress(), await weth.getAddress());
    const wrongFactoryManager = await Manager.deploy(await otherV3Factory.getAddress(), await weth.getAddress());
    const wrongWethManager = await Manager.deploy(await v3Factory.getAddress(), await wrongWeth.getAddress());
    const Locker = await ethers.getContractFactory("LaunchLocker");
    const locker = await Locker.deploy(await manager.getAddress(), treasury.address, deployer.address);
    const wrongLocker = await Locker.deploy(await wrongFactoryManager.getAddress(), treasury.address, deployer.address);
    const Factory = await ethers.getContractFactory("LaunchFactory");
    const args = [await weth.getAddress(), await v3Factory.getAddress(), await manager.getAddress(), await locker.getAddress(), treasury.address, 0] as const;

    await assertCustomError(
      Factory.deploy(await weth.getAddress(), await v3Factory.getAddress(), await wrongFactoryManager.getAddress(), await locker.getAddress(), treasury.address, 0),
      Factory,
      "InvalidParams",
    );
    await assertCustomError(
      Factory.deploy(await weth.getAddress(), await v3Factory.getAddress(), await wrongWethManager.getAddress(), await locker.getAddress(), treasury.address, 0),
      Factory,
      "InvalidParams",
    );
    await assertCustomError(
      Factory.deploy(await weth.getAddress(), await v3Factory.getAddress(), await manager.getAddress(), await wrongLocker.getAddress(), treasury.address, 0),
      Factory,
      "InvalidParams",
    );

    const factory = await Factory.deploy(...args);
    await factory.waitForDeployment();
    await locker.setFactory(await factory.getAddress());
    await assertCustomError(
      Factory.deploy(await weth.getAddress(), await v3Factory.getAddress(), await manager.getAddress(), await locker.getAddress(), treasury.address, 0),
      Factory,
      "InvalidParams",
    );
  });

  it("launches when the launch token sorts as token0", async () => {
    const { creator, factory, locker, manager, wethAddress } = await deploySystem();
    const { params } = await paramsForOrientation(factory, creator, wethAddress, true, "token0");
    const { predicted, graduation } = await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    const supply = await factory.TOKEN_SUPPLY();

    assert.equal(record.token, predicted);
    assert.equal(record.creator, creator.address);
    assert.equal(record.tickLower, -200_400n);
    assert.equal(record.tickUpper, -151_200n);
    assert.equal(record.usedLaunch, supply);
    assert.equal(record.dust, 0n);
    assert.equal(record.graduationWeth, graduation);
    assert.equal(await manager.ownerOf(record.positionId), await locker.getAddress());
  });

  it("launches when the launch token sorts as token1", async () => {
    const { creator, factory, wethAddress } = await deploySystem();
    const { params } = await paramsForOrientation(factory, creator, wethAddress, false, "token1");
    const { predicted } = await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);

    assert.equal(record.tickLower, 151_200n);
    assert.equal(record.tickUpper, 200_400n);
    assert.equal(record.usedLaunch, await factory.TOKEN_SUPPLY());
  });

  it("requires exact launch fee and valid params", async () => {
    const { creator, factory } = await deploySystem();
    await assertCustomError(
      factory.connect(creator).launch(baseParams(), { value: 1n }),
      factory,
      "InvalidParams",
    );
    await assertCustomError(
      factory.connect(creator).launch(baseParams({ initialBuyWeth: ethers.parseEther("0.01") }), {
        value: await factory.launchFee(),
      }),
      factory,
      "InvalidParams",
    );
    await assertCustomError(
      factory.connect(creator).launch(baseParams({ name: "" }), {
        value: await factory.launchFee(),
      }),
      factory,
      "InvalidParams",
    );
    await assertCustomError(
      factory.connect(creator).launch(baseParams({ symbol: "" }), { value: await factory.launchFee() }),
      factory,
      "InvalidParams",
    );
    await assertCustomError(
      factory.connect(creator).launch(baseParams({ metadataURI: "" }), { value: await factory.launchFee() }),
      factory,
      "InvalidParams",
    );
    await assertCustomError(
      factory.connect(creator).launch(baseParams({ salt: ethers.ZeroHash }), { value: await factory.launchFee() }),
      factory,
      "InvalidParams",
    );
  });

  it("sets launch fee immutably from the constructor", async () => {
    const { creator, factory } = await deploySystem();

    assert.equal(await factory.launchFee(), 0n);
    await launch(factory, creator, baseParams({ salt: ethers.id("zero-constructor-fee") }));
    assert.equal(await factory.accruedLaunchFees(), 0n);

    const fee = ethers.parseEther("0.0005");
    const { creator: paidCreator, factory: paidFactory } = await deploySystem(undefined, undefined, fee);
    assert.equal(await paidFactory.launchFee(), fee);
    await assertCustomError(
      paidFactory.connect(paidCreator).launch(baseParams({ salt: ethers.id("wrong-constructor-fee") }), { value: 0 }),
      paidFactory,
      "InvalidParams",
    );

    await launch(paidFactory, paidCreator, baseParams({ salt: ethers.id("paid-constructor-fee") }));
    assert.equal(await paidFactory.accruedLaunchFees(), fee);
  });

  it("hardwires launchpad defaults in the factory and token", async () => {
    const { creator, factory } = await deploySystem();
    assert.equal(await factory.TOKEN_SUPPLY(), ethers.parseUnits("1000000000", 18));
    assert.equal(await factory.STARTING_TICK(), -200_400n);
    assert.equal(await factory.RANGE_WIDTH(), 49_200n);
    assert.equal(await factory.CREATOR_SHARE_BPS(), 8_000n);
    assert.equal(await factory.MIN_SUPPLY_USED_BPS(), 9_900n);
    assert.equal(await factory.GRADUATION_WETH(), ethers.parseEther("23"));

    const { predicted } = await launch(factory, creator, baseParams({ salt: ethers.id("hardwired-defaults") }));
    const token = await ethers.getContractAt("LaunchToken", predicted);
    assert.equal(await token.totalSupply(), await factory.TOKEN_SUPPLY());
  });

  it("handles an existing uninitialized pool", async () => {
    const { creator, factory, v3Factory, wethAddress } = await deploySystem();
    const params = baseParams({ salt: ethers.id("existing-uninitialized") });
    const predicted = await factory.predictTokenAddress(params, creator.address);
    const pool = await v3Factory.createPool.staticCall(predicted, wethAddress, 10_000);
    await v3Factory.createPool(predicted, wethAddress, 10_000);

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    assert.equal(record.pool, pool);
  });

  it("accepts an existing pool at the expected price", async () => {
    const { creator, factory, v3Factory, wethAddress } = await deploySystem();
    const params = baseParams({ salt: ethers.id("existing-right-price") });
    const preview = await factory.previewLaunch(params, creator.address);
    const predicted = preview[0];
    const expectedSqrtPriceX96 = preview[8];
    const pool = await v3Factory.createPool.staticCall(predicted, wethAddress, 10_000);
    await v3Factory.createPool(predicted, wethAddress, 10_000);
    const MockPool = await ethers.getContractFactory("MockUniswapV3Pool");
    await MockPool.attach(pool).setSlot0(expectedSqrtPriceX96, 0);

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    assert.equal(record.pool, pool);
  });

  it("skips an existing initialized pool at the wrong price", async () => {
    const { creator, factory, v3Factory, wethAddress } = await deploySystem();
    const params = baseParams({ salt: ethers.id("existing-wrong-price") });
    const blockedToken = await factory.predictTokenAddress(params, creator.address);
    const blockedPool = await v3Factory.createPool.staticCall(blockedToken, wethAddress, 10_000);
    await v3Factory.createPool(blockedToken, wethAddress, 10_000);
    const MockPool = await ethers.getContractFactory("MockUniswapV3Pool");
    await MockPool.attach(blockedPool).setSlot0(123n, 0);

    const retryToken = await factory.predictTokenAddress(params, creator.address);
    assert.notEqual(retryToken, blockedToken);
    const { predicted } = await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    assert.equal(predicted, retryToken);
    assert.equal(record.token, retryToken);
    assert.notEqual(record.pool, blockedPool);
  });

  it("reverts only after every bounded salt candidate is poisoned", async () => {
    const { creator, factory, v3Factory, wethAddress } = await deploySystem();
    const params = baseParams({ salt: ethers.id("all-candidates-poisoned") });
    const MockPool = await ethers.getContractFactory("MockUniswapV3Pool");

    for (let i = 0; i < Number(await factory.MAX_SALT_ATTEMPTS()); i++) {
      const predicted = await factory.predictTokenAddress(params, creator.address);
      const pool = await v3Factory.createPool.staticCall(predicted, wethAddress, 10_000);
      await v3Factory.createPool(predicted, wethAddress, 10_000);
      await MockPool.attach(pool).setSlot0(123n, 0);
    }

    await assertCustomError(factory.predictTokenAddress(params, creator.address), factory, "NoUsableSalt");
    await assertCustomError(
      factory.connect(creator).launch(params, { value: await factory.launchFee() }),
      factory,
      "NoUsableSalt",
    );
  });

  it("rejects zero liquidity and tiny token-use launches", async () => {
    const { creator, factory, manager, wethAddress } = await deploySystem();
    const supply = await factory.TOKEN_SUPPLY();
    await manager.setNextMintResult(0, supply, 0, false);
    const { params: zeroLiquidityParams } = await paramsForOrientation(
      factory,
      creator,
      wethAddress,
      true,
      "zero-liquidity",
    );
    await assertCustomError(
      factory.connect(creator).launch(zeroLiquidityParams, {
        value: await factory.launchFee(),
      }),
      factory,
      "WrongTokenAmount",
    );

    await manager.setNextMintResult(1, supply / 2n, 0, false);
    const { params: lowUsedParams } = await paramsForOrientation(factory, creator, wethAddress, true, "low-used");
    await assertCustomError(
      factory.connect(creator).launch(lowUsedParams, {
        value: await factory.launchFee(),
      }),
      factory,
      "WrongTokenAmount",
    );
  });

  it("clears the position manager token allowance after minting liquidity", async () => {
    const { creator, factory, locker, manager, wethAddress } = await deploySystem();
    const supply = await factory.TOKEN_SUPPLY();
    const minUsed = (supply * (await factory.MIN_SUPPLY_USED_BPS())) / 10_000n;
    const { params } = await paramsForOrientation(factory, creator, wethAddress, true, "allowance-reset");

    await manager.setNextMintResult(1, minUsed, 0, false);
    const { predicted } = await launch(factory, creator, params);
    const token = await ethers.getContractAt("LaunchToken", predicted);

    assert.equal(await token.allowance(await factory.getAddress(), await manager.getAddress()), 0n);
    assert.equal(await token.balanceOf(await factory.getAddress()), 0n);
    assert.equal(await token.balanceOf(await locker.getAddress()), supply - minUsed);
  });

  it("accrues launch fees and uses pull claims", async () => {
    const fee = ethers.parseEther("0.0005");
    const { creator, treasury, factory } = await deploySystem(undefined, undefined, fee);
    await launch(factory, creator, baseParams({ salt: ethers.id("fees") }));
    assert.equal(await factory.accruedLaunchFees(), fee);
    await assertCustomError(factory.connect(creator).claimLaunchFees(), factory, "OnlyTreasury");

    const before = await ethers.provider.getBalance(treasury.address);
    const tx = await factory.connect(treasury).claimLaunchFees();
    const receipt = await tx.wait();
    assert.ok(receipt);
    const after = await ethers.provider.getBalance(treasury.address);
    assert.equal(after - before + receipt.gasUsed * receipt.gasPrice, fee);
    assert.equal(await factory.accruedLaunchFees(), 0n);
  });

  it("executes an atomic initial buy when the launch token is token0", async () => {
    const { creator, factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.01");
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      true,
      "initial-buy-token0",
      { initialBuyWeth: initialBuy },
    );

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);

    assert.equal(record.initialBuyWeth, initialBuy);
    assert.equal(record.initialBuyTokensOut, initialBuy);
    assert.equal(await weth.balanceOf(record.pool), initialBuy);
    const token = await ethers.getContractAt("LaunchToken", predicted);
    assert.equal(await token.balanceOf(creator.address), initialBuy);
    assert.equal(await weth.balanceOf(await factory.getAddress()), 0n);
    assert.equal(await factory.accruedLaunchFees(), await factory.launchFee());
  });

  it("executes an atomic initial buy when the launch token is token1", async () => {
    const { creator, factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.02");
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      false,
      "initial-buy-token1",
      { initialBuyWeth: initialBuy },
    );

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);

    assert.equal(record.initialBuyWeth, initialBuy);
    assert.equal(record.initialBuyTokensOut, initialBuy);
    assert.equal(await weth.balanceOf(record.pool), initialBuy);
    const token = await ethers.getContractAt("LaunchToken", predicted);
    assert.equal(await token.balanceOf(creator.address), initialBuy);
    assert.equal(await weth.balanceOf(await factory.getAddress()), 0n);
  });

  it("refunds unused WETH from a partial atomic initial buy when the launch token is token0", async () => {
    const { creator, factory, v3Factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.02");
    const spent = ethers.parseEther("0.01");
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      true,
      "partial-initial-buy-token0",
      { initialBuyWeth: initialBuy },
    );
    const pool = await precreatePool(v3Factory, predicted, await weth.getAddress());
    await pool.setNextSwap(-spent, spent, true);

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    const token = await ethers.getContractAt("LaunchToken", predicted);

    assert.equal(record.initialBuyWeth, initialBuy);
    assert.equal(record.initialBuyTokensOut, spent);
    assert.equal(await token.balanceOf(creator.address), spent);
    assert.equal(await weth.balanceOf(creator.address), initialBuy - spent);
    assert.equal(await weth.balanceOf(record.pool), spent);
    assert.equal(await weth.balanceOf(await factory.getAddress()), 0n);
  });

  it("refunds unused WETH from a partial atomic initial buy when the launch token is token1", async () => {
    const { creator, factory, v3Factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.02");
    const spent = ethers.parseEther("0.01");
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      false,
      "partial-initial-buy-token1",
      { initialBuyWeth: initialBuy },
    );
    const pool = await precreatePool(v3Factory, predicted, await weth.getAddress());
    await pool.setNextSwap(spent, -spent, true);

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    const token = await ethers.getContractAt("LaunchToken", predicted);

    assert.equal(record.initialBuyWeth, initialBuy);
    assert.equal(record.initialBuyTokensOut, spent);
    assert.equal(await token.balanceOf(creator.address), spent);
    assert.equal(await weth.balanceOf(creator.address), initialBuy - spent);
    assert.equal(await weth.balanceOf(record.pool), spent);
    assert.equal(await weth.balanceOf(await factory.getAddress()), 0n);
  });

  it("launches with unrestricted block-one transfers", async () => {
    const { creator, factory, v3Factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.02");
    const supply = await factory.TOKEN_SUPPLY();
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      true,
      "initial-buy-unrestricted",
      { initialBuyWeth: initialBuy },
    );
    const pool = await precreatePool(v3Factory, predicted, await weth.getAddress());
    await pool.setNextSwap(-supply, initialBuy, true);

    await launch(factory, creator, params);
    const token = await ethers.getContractAt("LaunchToken", predicted);
    assert.equal(await token.balanceOf(creator.address), supply);
  });

  it("rejects a malformed initial buy swap that spends more WETH than supplied", async () => {
    const { creator, factory, v3Factory, weth } = await deploySystemWithMockWeth();
    const initialBuy = ethers.parseEther("0.01");
    const { params, predicted } = await paramsForOrientation(
      factory,
      creator,
      await weth.getAddress(),
      true,
      "initial-buy-overspend",
      { initialBuyWeth: initialBuy },
    );
    const pool = await precreatePool(v3Factory, predicted, await weth.getAddress());
    await pool.setNextSwap(-initialBuy, initialBuy + 1n, true);
    await weth.deposit({ value: 1n });
    await weth.transfer(await factory.getAddress(), 1n);

    await assertCustomError(
      factory.connect(creator).launch(params, { value: (await factory.launchFee()) + initialBuy }),
      factory,
      "InvalidSwapCallback",
    );
  });

  it("rejects direct swap callbacks outside an active initial buy", async () => {
    const { factory } = await deploySystem();
    await assertCustomError(factory.uniswapV3SwapCallback(1, -1, "0x"), factory, "UnauthorizedSwapCallback");
  });

  it("does not let a reverting treasury brick launches", async () => {
    const RevertingTreasury = await ethers.getContractFactory("RevertingTreasury");
    const rejectingTreasury = await RevertingTreasury.deploy();
    const { creator, factory } = await deploySystem(undefined, await rejectingTreasury.getAddress(), ethers.parseEther("0.0005"));
    await launch(factory, creator, baseParams({ salt: ethers.id("reverting-treasury") }));
    assert.equal(await factory.accruedLaunchFees(), await factory.launchFee());
  });
});
