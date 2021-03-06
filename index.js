import Web3 from "web3"
import { readFileSync } from "fs"
import pino from "pino"

const PROVIDER_URL = "https://rpc.ftm.tools/"
const SUMMIT_CONTRACT_ADDRESS = "0x46d303b6829aDc7AC3217D92f71B1DbbE77eBBA2"
const SUMMIT_CONTRACT_ABI = JSON.parse(readFileSync("./abi/summit_abi.json"))
const SUMMIT_TOKEN_ABI = JSON.parse(readFileSync("./abi/summit_token_abi.json"))
const SUMMIT_TOKEN_ADDRESS = "0x8F9bCCB6Dd999148Da1808aC290F2274b13D7994"
const SPOOKY_ROUTER_ADDRESS = "0xf491e7b69e4244ad4002bc14e878a34207e38c29"
const SPOOKY_ROUTER_ABI = JSON.parse(readFileSync("./abi/spooky_abi.json"))
const PRIVATE_KEY = process.env.PRIVATE_KEY

const SUMMIT = "0x8f9bccb6dd999148da1808ac290f2274b13d7994"
const WFTM = "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83"

if (!process.argv[2]) {
    throw new Error("Please specify the rollover position")
}

const position = parseInt(process.argv[2])
const web3 = new Web3(PROVIDER_URL)
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY)
const address = account.address
const logger = pino(`rollover${position}_${Date.now()}.log`)

// Add our account to the wallet to be able to use contracts
web3.eth.accounts.wallet.add(account)

const rolloverContract = new web3.eth.Contract(
    SUMMIT_CONTRACT_ABI,
    SUMMIT_CONTRACT_ADDRESS
)
const summitContract = new web3.eth.Contract(
    SUMMIT_TOKEN_ABI,
    SUMMIT_TOKEN_ADDRESS
)
const routerContract = new web3.eth.Contract(
    SPOOKY_ROUTER_ABI,
    SPOOKY_ROUTER_ADDRESS
)

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

async function start() {
    logger.info(`Starting rollover bot for address ${address}`)

    while (true) {
        try {
            // Get rollover event timestamp
            const roundEndTimestamp = parseInt(
                await rolloverContract.methods
                    .roundEndTimestamp(position)
                    .call()
            )

            const timestamp = Date.now() / 1000

            // Sleep until 250 seconds before the rollover
            if (roundEndTimestamp - timestamp > 500) {
                logger.info("Sleeping")
                await sleep((roundEndTimestamp - timestamp - 250) * 1000)
                continue
            }

            if (timestamp < roundEndTimestamp - 5) continue

            logger.info(
                `Rollover ${position} available, round timestamp: ${roundEndTimestamp}`
            )

            // Execute the rollover and claim the rewards
            const receipt = await rollover(roundEndTimestamp)

            await waitTransaction(receipt.transactionHash)

            await sleep(250000)

            await swapRewardsForFTM()

            await sleep(250000)
        } catch (err) {
            logger.error(err.message)
        }
    }
}

async function rollover(timestamp) {
    logger.info(
        `Trying to rollover elevation ${position}, timestamp: ${
            Date.now() / 1000
        }`
    )

    while (true) {
        try {
            const gasPrice = await web3.eth.getGasPrice()

            const gasAmount = await rolloverContract.methods
                .rollover(position)
                .estimateGas({ from: address, gas: 10000000 })

            const receipt = await rolloverContract.methods
                .rollover(position)
                .send({
                    from: address,
                    gasPrice: (gasPrice * 1.05).toString(),
                    gas: Math.round(gasAmount * 1.1),
                })

            logger.info(
                `Rollover successfull, tx hash: ${receipt.transactionHash}`
            )

            return receipt
        } catch (err) {
            logger.error(err.message)
            if (
                err.message.includes("Transaction has been reverted by the EVM")
            ) {
                throw new Error("Transaction reverted")
            }

            if (Date.now() / 1000 > timestamp + 100) {
                throw new Error("Timeout")
            }
        }
    }
}

async function swapRewardsForFTM() {
    // Swap parameters
    const slippage = 0.01
    const deadline = Math.round(Date.now() / 1000 + 100)
    const path = [SUMMIT, WFTM]

    // Get summit rewards balance
    const summitBalance = await summitContract.methods.balanceOf(address).call()

    const [_, ftmAmount] = await routerContract.methods
        .getAmountsOut(summitBalance, path)
        .call()

    const minFTMAmount = web3.utils.toBN(
        Math.round(ftmAmount - ftmAmount * slippage)
    )

    const gasPrice = await web3.eth.getGasPrice()
    const gasAmount = await routerContract.methods
        .swapExactTokensForETH(
            summitBalance,
            minFTMAmount,
            path,
            address,
            deadline
        )
        .estimateGas({ from: address, gas: 10000000 })

    const receipt = await routerContract.methods
        .swapExactTokensForETH(
            summitBalance,
            minFTMAmount,
            path,
            address,
            deadline
        )
        .send({
            from: address,
            gasPrice,
            gas: Math.round(gasAmount * 1.5),
        })

    logger.info(`Swapped SUMMIT for FTM, tx hash: ${receipt.transactionHash}`)
}

async function waitTransaction(txHash, interval) {
    while (true) {
        const receipt = await web3.eth.getTransactionReceipt(txHash)
        if (receipt != null) return receipt
        await sleep(interval ? interval : 500)
    }
}

start()
