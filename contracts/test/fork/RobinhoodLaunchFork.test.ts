import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

const { ethers } = await network.create(process.env.RH_ARCHIVE_RPC_URL ? "hardhat" : undefined);

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const LAUNCH_FEE = 0n;

const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const positionManagerAbi = [
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fork Sherwood",
    symbol: "FSW",
    metadataURI: "ipfs://fork-metadata",
    initialBuyWeth: 0n,
    salt: ethers.id(`fork-salt-${Math.random()}`),
    ...overrides,
  };
}

function addressLt(a: string, b: string) {
  return BigInt(a) < BigInt(b);
}

async function deployForkSystem() {
  const [deployer, creator, treasury] = await ethers.getSigners();
  const Locker = await ethers.getContractFactory("LaunchLocker");
  const locker = await Locker.deploy(POSITION_MANAGER, treasury.address, deployer.address);
  await locker.waitForDeployment();

  const Factory = await ethers.getContractFactory("LaunchFactory");
  const factory = await Factory.deploy(WETH, V3_FACTORY, POSITION_MANAGER, await locker.getAddress(), treasury.address, LAUNCH_FEE);
  await factory.waitForDeployment();

  await (await locker.setFactory(await factory.getAddress())).wait();
  return { deployer, creator, treasury, locker, factory };
}

async function paramsForOrientation(factory: any, creator: any, wantLaunchTokenIsToken0: boolean, label: string, overrides = {}) {
  for (let i = 0; i < 500; i++) {
    const params = baseParams({ ...overrides, salt: ethers.id(`${label}-${i}`) });
    const predicted = await factory.predictTokenAddress(params, creator.address);
    if (addressLt(predicted, WETH) === wantLaunchTokenIsToken0) return { params, predicted };
  }
  throw new Error(`Unable to find ${label} salt for requested token orientation`);
}

async function launch(factory: any, creator: any, params = baseParams()) {
  const predicted = await factory.predictTokenAddress(params, creator.address);
  const tx = await factory.connect(creator).launch(params, { value: LAUNCH_FEE + (params.initialBuyWeth as bigint) });
  await tx.wait();
  return predicted;
}

describe("Robinhood fork", { skip: !process.env.RH_ARCHIVE_RPC_URL }, () => {
  it("verifies canonical V3 wiring", async () => {
    await ethers.provider.send("evm_mine", []);

    assert.notEqual(await ethers.provider.getCode(WETH), "0x");
    assert.notEqual(await ethers.provider.getCode(V3_FACTORY), "0x");
    assert.notEqual(await ethers.provider.getCode(POSITION_MANAGER), "0x");

    const v3Factory = new ethers.Contract(V3_FACTORY, ["function feeAmountTickSpacing(uint24) view returns (int24)"], ethers.provider);
    const manager = new ethers.Contract(POSITION_MANAGER, positionManagerAbi, ethers.provider);

    assert.equal(await v3Factory.feeAmountTickSpacing(10_000), 200n);
    assert.equal(await manager.factory(), V3_FACTORY);
    assert.equal(await manager.WETH9(), WETH);
  });

  it("executes a real launch without an initial buy", async () => {
    const { creator, factory, locker } = await deployForkSystem();
    const { params, predicted } = await paramsForOrientation(factory, creator, true, "fork-launch-no-buy");

    await launch(factory, creator, params);
    const record = await factory.launchByToken(predicted);
    const manager = new ethers.Contract(POSITION_MANAGER, positionManagerAbi, ethers.provider);

    assert.notEqual(await ethers.provider.getCode(predicted), "0x");
    assert.notEqual(await ethers.provider.getCode(record.pool), "0x");
    assert.equal(record.token, predicted);
    assert.equal(record.creator, creator.address);
    assert.equal(await manager.ownerOf(record.positionId), await locker.getAddress());
    assert.ok(record.usedLaunch >= ((await factory.TOKEN_SUPPLY()) * (await factory.MIN_SUPPLY_USED_BPS())) / 10_000n);
    assert.equal(record.initialBuyWeth, 0n);
    assert.equal(record.initialBuyTokensOut, 0n);
    assert.equal(record.graduationWeth, await factory.GRADUATION_WETH());
  });

  it("executes real atomic initial buys for both token orientations", async () => {
    for (const launchTokenIsToken0 of [true, false]) {
      const { creator, factory, locker } = await deployForkSystem();
      const initialBuy = ethers.parseEther("0.001");
      const { params, predicted } = await paramsForOrientation(
        factory,
        creator,
        launchTokenIsToken0,
        `fork-initial-buy-${launchTokenIsToken0 ? "token0" : "token1"}`,
        { initialBuyWeth: initialBuy },
      );
      const weth = new ethers.Contract(WETH, erc20Abi, ethers.provider);
      const beforeCreatorWeth = await weth.balanceOf(creator.address);

      await launch(factory, creator, params);
      const record = await factory.launchByToken(predicted);
      const token = new ethers.Contract(predicted, erc20Abi, ethers.provider);
      const manager = new ethers.Contract(POSITION_MANAGER, positionManagerAbi, ethers.provider);

      assert.equal(await manager.ownerOf(record.positionId), await locker.getAddress());
      assert.equal(record.initialBuyWeth, initialBuy);
      assert.ok(record.initialBuyTokensOut > 0n);
      assert.equal(await token.balanceOf(creator.address), record.initialBuyTokensOut);
      assert.equal(await weth.balanceOf(await factory.getAddress()), 0n);
      assert.ok((await weth.balanceOf(creator.address)) >= beforeCreatorWeth);
    }
  });
});
