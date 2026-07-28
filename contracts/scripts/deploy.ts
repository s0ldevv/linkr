import { network } from "hardhat";

const { ethers } = await network.create("robinhood");

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const LAUNCH_FEE = 0n;

const v3FactoryAbi = ["function feeAmountTickSpacing(uint24 fee) view returns (int24)"];
const positionManagerAbi = ["function factory() view returns (address)", "function WETH9() view returns (address)"];
const wethAbi = ["function deposit() payable"];

function requireAddress(name: string): string {
  const value = process.env[name];
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be set to a non-zero address`);
  }
  return value;
}

async function requireCode(label: string, address: string) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${label} has no bytecode at ${address}`);
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
}

async function assertWethDepositCall(weth: string, from: string) {
  const data = new ethers.Interface(wethAbi).encodeFunctionData("deposit");
  await ethers.provider.call({ from, to: weth, data, value: 1n });
}

async function preflight(deployer: string) {
  await requireCode("WETH", WETH);
  await requireCode("V3 factory", V3_FACTORY);
  await requireCode("Position manager", POSITION_MANAGER);

  const v3Factory = new ethers.Contract(V3_FACTORY, v3FactoryAbi, ethers.provider);
  const manager = new ethers.Contract(POSITION_MANAGER, positionManagerAbi, ethers.provider);

  assertEqual("V3 1pct spacing", await v3Factory.feeAmountTickSpacing(10_000), 200n);
  assertEqual("manager.factory", await manager.factory(), V3_FACTORY);
  assertEqual("manager.WETH9", await manager.WETH9(), WETH);
  await assertWethDepositCall(WETH, deployer);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = requireAddress("PROTOCOL_TREASURY");
  await preflight(deployer.address);

  const Locker = await ethers.getContractFactory("LaunchLocker");
  const locker = await Locker.deploy(POSITION_MANAGER, treasury, deployer.address);
  await locker.waitForDeployment();

  const Factory = await ethers.getContractFactory("LaunchFactory");
  const factory = await Factory.deploy(
    WETH,
    V3_FACTORY,
    POSITION_MANAGER,
    await locker.getAddress(),
    treasury,
    LAUNCH_FEE,
  );
  await factory.waitForDeployment();

  await (await locker.setFactory(await factory.getAddress())).wait();
  console.log(
    JSON.stringify(
      {
        deployer: deployer.address,
        treasury,
        locker: await locker.getAddress(),
        factory: await factory.getAddress(),
        launchFee: LAUNCH_FEE.toString(),
        launchDefaults: {
          tokenSupply: (await factory.TOKEN_SUPPLY()).toString(),
          startingTick: (await factory.STARTING_TICK()).toString(),
          rangeWidth: (await factory.RANGE_WIDTH()).toString(),
          creatorShareBps: (await factory.CREATOR_SHARE_BPS()).toString(),
          minSupplyUsedBps: (await factory.MIN_SUPPLY_USED_BPS()).toString(),
          graduationWeth: (await factory.GRADUATION_WETH()).toString(),
          trading: "block-1-unrestricted",
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
