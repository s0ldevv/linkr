import { network } from "hardhat";

const { ethers } = await network.create();

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const EXPECTED_LAUNCH_FEE = 0n;

const v3FactoryAbi = ["function feeAmountTickSpacing(uint24 fee) view returns (int24)"];
const positionManagerAbi = ["function factory() view returns (address)", "function WETH9() view returns (address)"];

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

async function main() {
  const factoryAddress = requireAddress("FACTORY_ADDRESS");
  const lockerAddress = requireAddress("LOCKER_ADDRESS");
  const treasury = requireAddress("PROTOCOL_TREASURY");

  await requireCode("LaunchFactory", factoryAddress);
  await requireCode("LaunchLocker", lockerAddress);
  await requireCode("WETH", WETH);
  await requireCode("V3 factory", V3_FACTORY);
  await requireCode("Position manager", POSITION_MANAGER);

  const factory = await ethers.getContractAt("LaunchFactory", factoryAddress);
  const locker = await ethers.getContractAt("LaunchLocker", lockerAddress);
  const v3Factory = new ethers.Contract(V3_FACTORY, v3FactoryAbi, ethers.provider);
  const manager = new ethers.Contract(POSITION_MANAGER, positionManagerAbi, ethers.provider);

  const checks: Array<[string, boolean]> = [
    ["factory.WETH", (await factory.WETH()) === WETH],
    ["factory.v3Factory", (await factory.v3Factory()) === V3_FACTORY],
    ["factory.positionManager", (await factory.positionManager()) === POSITION_MANAGER],
    ["factory.locker", (await factory.locker()) === lockerAddress],
    ["factory.treasury", (await factory.treasury()) === treasury],
    ["locker.factory", (await locker.factory()) === factoryAddress],
    ["locker.treasury", (await locker.treasury()) === treasury],
    ["launchFee", (await factory.launchFee()) === EXPECTED_LAUNCH_FEE],
    ["TOKEN_SUPPLY", (await factory.TOKEN_SUPPLY()) === ethers.parseUnits("1000000000", 18)],
    ["STARTING_TICK", (await factory.STARTING_TICK()) === -200_400n],
    ["RANGE_WIDTH", (await factory.RANGE_WIDTH()) === 49_200n],
    ["CREATOR_SHARE_BPS", (await factory.CREATOR_SHARE_BPS()) === 8_000n],
    ["MIN_SUPPLY_USED_BPS", (await factory.MIN_SUPPLY_USED_BPS()) === 9_900n],
    ["GRADUATION_WETH", (await factory.GRADUATION_WETH()) === ethers.parseEther("23")],
    ["V3 1pct spacing", (await v3Factory.feeAmountTickSpacing(10_000)) === 200n],
    ["manager.factory", (await manager.factory()) === V3_FACTORY],
    ["manager.WETH9", (await manager.WETH9()) === WETH],
  ];

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    throw new Error(`Smoke checks failed: ${failed.map(([label]) => label).join(", ")}`);
  }

  console.log("Robinhood launch contracts smoke checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
