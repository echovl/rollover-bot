import Web3 from "web3"
import { readFileSync } from "fs"
import pino from "pino"

const logger = pino()
const PROVIDER_URL = "https://rpc.ftm.tools/"
const SUMMIT_CONTRACT_ADDRESS = "0x46d303b6829aDc7AC3217D92f71B1DbbE77eBBA2"
const SUMMIT_CONTRACT_ABI = JSON.parse(readFileSync("./abi.json"))
const PRIVATE_KEY = process.env.PRIVATE_KEY

async function run() {
    const web3 = new Web3(PROVIDER_URL)

    const contract = new web3.eth.Contract(
        SUMMIT_CONTRACT_ABI,
        SUMMIT_CONTRACT_ADDRESS
    )

    const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY)
    web3.eth.accounts.wallet.add(account)

    const balance = web3.utils.fromWei(
        await web3.eth.getBalance(account.address)
    )

    while (true) {
        try {
            logger.info(`Balance: ${balance} FTM`)

            const roundEndTimestamp = await contract.methods
                .roundEndTimestamp(1)
                .call()

            const block = await web3.eth.getBlock("latest")
            const gasPrice = await web3.eth.getGasPrice()
            const timestamp = Date.now() / 1000

            logger.info(`Block ${block.number}, Timestamp: ${block?.timestamp}`)
            logger.info(`Machine timestamp: ${Date.now() / 1000}`)
            logger.info(`RoundEndTimestamp: ${roundEndTimestamp}`)
            logger.info(`Gas price: ${web3.utils.fromWei(gasPrice, "gwei")}`)

            if (timestamp >= roundEndTimestamp) {
                logger.info("Rollover available ...")

                const gasAmount = await contract.methods
                    .rollover(1)
                    .estimateGas({ from: account.address, gas: 10000000 })

                const receipt = await contract.methods.rollover(1).send({
                    from: account.address,
                    gasPrice,
                    gas: Math.round(gasAmount * 1.5),
                })

                logger.info(`Tx hash: ${receipt}`)
            } else {
            }
        } catch (err) {
            logger.error(`Error: ${err.message}`)
        }
    }
}

run()
