import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { worldChainSepolia } from '../constants/chains';
import { CONTRACT_ADDRESSES, WORLD_STAKING_ABI } from '../constants/contracts';
import { ContractStakeDetails, UserTradeValueUpdate } from '../types/index';
import databaseManager from './database.js';

class BlockchainManager {
  private publicClient;
  private walletClient;
  private account;

  constructor(privateKey: string) {
    // Create account from private key
    this.account = privateKeyToAccount(`0x${privateKey.replace('0x', '')}`);

    // Create clients
    this.publicClient = createPublicClient({
      chain: worldChainSepolia,
      transport: http()
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: worldChainSepolia,
      transport: http()
    });

    console.log(`Blockchain manager initialized with account: ${this.account.address}`);
  }

  /**
   * Gets all users who have staked tokens by reading past events
   */
  async getAllStakers(): Promise<`0x${string}`[]> {
    try {
      const stakedEvents = await this.publicClient.getLogs({
        address: CONTRACT_ADDRESSES.WORLD_STAKING as `0x${string}`,
        event: {
          type: 'event',
          name: 'Staked',
          inputs: [
            { type: 'address', name: 'user', indexed: true },
            { type: 'uint256', name: 'amount' },
            { type: 'uint256', name: 'tradingAmount' },
            { type: 'uint256', name: 'timestamp' }
          ]
        },
        fromBlock: 'earliest'
      });

      // Get unique users
      const uniqueUsers = Array.from(
        new Set(stakedEvents.map(event => event.args.user as `0x${string}`))
      );

      console.log(`Found ${uniqueUsers.length} unique stakers`);
      return uniqueUsers;
    } catch (error) {
      console.error('Error getting stakers:', error);
      throw error;
    }
  }

  /**
   * Gets stake details for a specific user and stake index
   */
  async getStakeDetails(userAddress: `0x${string}`, stakeIndex: number): Promise<ContractStakeDetails | null> {
    try {
      const result = await this.publicClient.readContract({
        address: CONTRACT_ADDRESSES.WORLD_STAKING as `0x${string}`,
        abi: WORLD_STAKING_ABI,
        functionName: 'getStakeDetails',
        args: [userAddress, BigInt(stakeIndex)]
      }) as unknown as [bigint, bigint, bigint, bigint, boolean, bigint, boolean];

      return {
        amount: result[0],
        timestamp: result[1],
        tradingAmount: result[2],
        currentTradeValue: result[3],
        tradeActive: result[4],
        claimableRewards: result[5],
        active: result[6]
      };
    } catch (error) {
      console.error(`Error getting stake details for ${userAddress}[${stakeIndex}]:`, error);
      return null;
    }
  }

  /**
   * Gets the total number of stakes for a user
   */
  async getStakeCount(userAddress: `0x${string}`): Promise<number> {
    try {
      const count = await this.publicClient.readContract({
        address: CONTRACT_ADDRESSES.WORLD_STAKING as `0x${string}`,
        abi: WORLD_STAKING_ABI,
        functionName: 'getStakeCount',
        args: [userAddress]
      }) as bigint;

      return Number(count);
    } catch (error) {
      console.error(`Error getting stake count for ${userAddress}:`, error);
      return 0;
    }
  }

  /**
   * Updates the trade value for a specific stake
   */
  async updateTradeValue(
    userAddress: `0x${string}`,
    stakeIndex: number,
    newValue: bigint
  ): Promise<{ success: boolean; txHash?: string }> {
    try {
      console.log(`Updating trade value for ${userAddress}[${stakeIndex}] to ${newValue}`);

      const txHash = await this.walletClient.writeContract({
        address: CONTRACT_ADDRESSES.WORLD_STAKING as `0x${string}`,
        abi: WORLD_STAKING_ABI,
        functionName: 'updateTradeValue',
        args: [userAddress, BigInt(stakeIndex), newValue]
      });

      console.log(`Trade value updated. Transaction hash: ${txHash}`);
      return { success: true, txHash };
    } catch (error) {
      console.error(`Error updating trade value for ${userAddress}[${stakeIndex}]:`, error);
      return { success: false };
    }
  }

  /**
   * Exits a trade with a final value
   */
  async exitTrade(
    userAddress: `0x${string}`,
    stakeIndex: number,
    finalValue: bigint
  ): Promise<boolean> {
    try {
      console.log(`Exiting trade for ${userAddress}[${stakeIndex}] with final value ${finalValue}`);

      const txHash = await this.walletClient.writeContract({
        address: CONTRACT_ADDRESSES.WORLD_STAKING as `0x${string}`,
        abi: WORLD_STAKING_ABI,
        functionName: 'exitTrade',
        args: [userAddress, BigInt(stakeIndex), finalValue]
      });

      console.log(`Trade exited. Transaction hash: ${txHash}`);
      return true;
    } catch (error) {
      console.error(`Error exiting trade for ${userAddress}[${stakeIndex}]:`, error);
      return false;
    }
  }

  /**
   * Applies P&L percentage to trading amount
   */
  calculateNewTradeValue(tradingAmount: bigint, pnlPercentage: string): bigint {
    try {
      // Parse the P&L percentage (remove % sign and convert to number)
      const pnlValue = parseFloat(pnlPercentage.replace('%', ''));

      console.log(`Calculating new trade value: ${tradingAmount} with P&L: ${pnlValue}%`);

      // For positive P&L, add to trading amount
      if (pnlValue > 0) {
        const changeAmount = (Number(tradingAmount) * pnlValue) / 100;
        const changeBigInt = BigInt(Math.floor(changeAmount));
        const newValue = tradingAmount + changeBigInt;
        console.log(`Positive P&L: ${tradingAmount} + ${changeBigInt} = ${newValue}`);
        return newValue;
      }
      // For negative P&L, subtract from trading amount
      else if (pnlValue < 0) {
        const changeAmount = (Number(tradingAmount) * Math.abs(pnlValue)) / 100;
        const changeBigInt = BigInt(Math.floor(changeAmount));
        const newValue = tradingAmount - changeBigInt;

        // Ensure minimum value is not negative or zero
        const finalValue = newValue < 0n ? 0n : newValue;

        console.log(`Negative P&L: ${tradingAmount} - ${changeBigInt} = ${finalValue}`);
        return finalValue;
      }
      // For zero P&L, return original value
      else {
        console.log(`Zero P&L: returning original value ${tradingAmount}`);
        return tradingAmount;
      }
    } catch (error) {
      console.error(`Error calculating new trade value for P&L ${pnlPercentage}:`, error);
      return tradingAmount; // Return original value if calculation fails
    }
  }

  /**
   * Updates trading values for all active stakes of a user based on total sum P&L
   * Applies P&L directly to the trading amount
   */
  async updateUserTradesWithSignals(
    userAddress: `0x${string}`,
    totalSumPnL: string
  ): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;

    try {
      const stakeCount = await this.getStakeCount(userAddress);

      for (let i = 0; i < stakeCount; i++) {
        const stakeDetails = await this.getStakeDetails(userAddress, i);

        if (!stakeDetails || !stakeDetails.active || !stakeDetails.tradeActive) {
          continue; // Skip inactive or non-trading stakes
        }

        // Calculate new trade value based on total sum P&L applied to trading amount
        const newTradeValue = this.calculateNewTradeValue(
          stakeDetails.tradingAmount, // Apply P&L to trading amount
          totalSumPnL
        );

        // Update the trade value
        const updateResult = await this.updateTradeValue(userAddress, i, newTradeValue);

        if (updateResult.success) {
          updated++;
          console.log(
            `Updated stake ${i} for ${userAddress}: ` +
            `trading amount ${stakeDetails.tradingAmount} -> new trade value ${newTradeValue} ` +
            `(${totalSumPnL} P&L applied to trading amount)` +
            (updateResult.txHash ? ` - TX: ${updateResult.txHash}` : '')
          );

          // Store the trade value update in database
          try {
            const tradeUpdate: UserTradeValueUpdate = {
              subscriberAddress: userAddress,
              stakeIndex: i,
              originalTradingAmount: stakeDetails.tradingAmount.toString(),
              newTradeValue: newTradeValue.toString(),
              pnlPercentage: totalSumPnL,
              updatedAt: new Date(),
              blockchainTxHash: updateResult.txHash
            };
            await databaseManager.storeTradeValueUpdate(tradeUpdate);
          } catch (dbError) {
            console.error(`Error storing trade value update in database:`, dbError);
          }
        } else {
          errors++;
        }

        // Add a small delay to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error updating trades for user ${userAddress}:`, error);
      errors++;
    }

    return { updated, errors };
  }

  /**
   * Health check for blockchain connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      console.log(`Blockchain health check passed. Current block: ${blockNumber}`);
      return true;
    } catch (error) {
      console.error('Blockchain health check failed:', error);
      return false;
    }
  }
}

export default BlockchainManager; 