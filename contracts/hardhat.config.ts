import hardhatEthersPlugin from "@nomicfoundation/hardhat-ethers";
import "dotenv/config";
import { defineConfig } from "hardhat/config";

const robinhoodForkUrl = process.env.RH_ARCHIVE_RPC_URL;
const robinhoodForkBlock = process.env.ROBINHOOD_FORK_BLOCK
  ? Number(process.env.ROBINHOOD_FORK_BLOCK)
  : undefined;

const config = defineConfig({
  plugins: [hardhatEthersPlugin],
  solidity: {
    compilers: [
      { version: "0.8.26", settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 500 }, viaIR: true } },
      { version: "0.7.6", settings: { optimizer: { enabled: true, runs: 500 } } }
    ]
  },
  networks: {
    hardhat: robinhoodForkUrl
      ? {
          type: "edr-simulated",
          chainType: "l1",
          forking: {
            url: robinhoodForkUrl,
            blockNumber: robinhoodForkBlock
          }
        }
      : {
          type: "edr-simulated",
          chainType: "l1"
        },
    robinhood: {
      type: "http",
      chainType: "l1",
      url: process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  }
});
export default config;
