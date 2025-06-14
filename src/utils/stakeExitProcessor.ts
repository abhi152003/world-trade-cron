import { UserStakes, StakeRecord, BacktestingSignal, StakeExitData } from '../types/index.js';
import databaseManager from './database.js';

/**
 * Filters signals to only include those with valid Final P&L values
 */
export function filterValidSignals(signals: BacktestingSignal[]): BacktestingSignal[] {
  return signals.filter(signal => {
    const finalPnL = signal["Final P&L"];
    
    // Check if Final P&L exists and is not empty
    if (!finalPnL || finalPnL === "") {
      return false;
    }

    // Check if it's a valid percentage value
    try {
      const pnlValue = parseFloat(finalPnL.replace('%', ''));
      return !isNaN(pnlValue);
    } catch {
      return false;
    }
  });
}

/**
 * Gets signals within a specific time range
 */
export function getSignalsInRange(
  signals: BacktestingSignal[],
  fromDate: Date,
  toDate: Date
): BacktestingSignal[] {
  return signals.filter(signal => {
    const signalDate = new Date(signal["Signal Generation Date"]);
    return signalDate >= fromDate && signalDate <= toDate;
  });
}

/**
 * Calculates the total sum P&L for a set of signals
 */
export function calculateTotalSumPnL(signals: BacktestingSignal[]): string {
  if (signals.length === 0) {
    return "0%";
  }

  let totalPnL = 0;
  let validSignalsCount = 0;

  for (const signal of signals) {
    try {
      // Parse the P&L percentage (remove % sign and convert to number)
      const pnlValue = parseFloat(signal["Final P&L"].replace('%', ''));
      
      if (!isNaN(pnlValue)) {
        totalPnL += pnlValue;
        validSignalsCount++;
      }
    } catch (error) {
      console.warn(`Invalid P&L value for signal ${signal._id}: ${signal["Final P&L"]}`);
    }
  }

  if (validSignalsCount === 0) {
    return "0%";
  }

  return `${totalPnL.toFixed(2)}%`;
}

/**
 * Calculates the final trade value based on stake amount and P&L
 * Returns the value in wei as a string that can be converted to BigInt
 */
export function calculateFinalTradeValue(stakeAmount: number, totalPnLPercentage: string): string {
  // Convert stake amount from ETH to wei first
  const stakeAmountWei = stakeAmount * 1e18;
  
  // Calculate trading amount (2% of stake amount in wei)
  const tradingAmountWei = (stakeAmountWei * 2) / 100;
  
  const pnlValue = parseFloat(totalPnLPercentage.replace('%', ''));
  
  if (isNaN(pnlValue)) {
    return Math.floor(tradingAmountWei).toString();
  }

  // Apply P&L to trading amount
  const finalValueWei = tradingAmountWei + (tradingAmountWei * pnlValue / 100);
  
  // Ensure minimum value is not negative and convert to integer
  return Math.max(0, Math.floor(finalValueWei)).toString();
}

/**
 * Processes all stakes ready to exit and calculates their final trade values
 */
export async function processStakeExits(
  stakesReadyToExit: { userStakes: UserStakes; readyStakes: { index: number; stake: StakeRecord }[] }[],
  signalsMap: Map<string, BacktestingSignal[]>
): Promise<StakeExitData[]> {
  const stakeExitResults: StakeExitData[] = [];

  // Get all influencers to match signals
  const influencers = await databaseManager.getAllInfluencers();
  const influencerNamesSet = new Set(influencers.map(inf => inf.name));

  for (const userStakeData of stakesReadyToExit) {
    for (const readyStake of userStakeData.readyStakes) {
      const fromDate = new Date(readyStake.stake.timestamp);
      const toDate = new Date(readyStake.stake.exitTimestamp);
      
      console.log(`Processing stake for ${userStakeData.userStakes.walletAddress}[${readyStake.index}]: ${fromDate.toISOString()} to ${toDate.toISOString()}`);

      // Collect all relevant signals for this stake period from all influencers
      const relevantSignals: BacktestingSignal[] = [];
      
      for (const [influencerName, signals] of signalsMap) {
        if (influencerNamesSet.has(influencerName)) {
          const signalsInRange = getSignalsInRange(signals, fromDate, toDate);
          relevantSignals.push(...signalsInRange);
        }
      }

      // Filter for valid signals
      const validSignals = filterValidSignals(relevantSignals);
      
      console.log(`Found ${validSignals.length} valid signals for stake period`);

      // Calculate total P&L
      const totalPnL = calculateTotalSumPnL(validSignals);
      
      // Calculate final trade value
      const finalTradeValue = calculateFinalTradeValue(readyStake.stake.stakeAmount, totalPnL);

      const stakeExitData: StakeExitData = {
        walletAddress: userStakeData.userStakes.walletAddress,
        stakeIndex: readyStake.index,
        stakeRecord: readyStake.stake,
        signals: validSignals,
        totalPnL,
        finalTradeValue
      };

      stakeExitResults.push(stakeExitData);

      console.log(
        `Stake exit data for ${userStakeData.userStakes.walletAddress}[${readyStake.index}]: ` +
        `${validSignals.length} signals, total P&L: ${totalPnL}, final trade value: ${finalTradeValue}`
      );
    }
  }

  return stakeExitResults;
}

/**
 * Generates a summary report of stake exits
 */
export function generateStakeExitSummary(stakeExitResults: StakeExitData[]): string {
  const totalStakes = stakeExitResults.length;
  let profitableStakes = 0;
  let unprofitableStakes = 0;
  let totalSignalsProcessed = 0;
  
  for (const result of stakeExitResults) {
    totalSignalsProcessed += result.signals.length;
    
    const totalPnL = parseFloat(result.totalPnL.replace('%', ''));
    if (totalPnL > 0) {
      profitableStakes++;
    } else if (totalPnL < 0) {
      unprofitableStakes++;
    }
  }
  
  return `
Stake Exit Processing Summary:
- Total stakes ready to exit: ${totalStakes}
- Total signals processed: ${totalSignalsProcessed}
- Stakes with positive P&L: ${profitableStakes}
- Stakes with negative P&L: ${unprofitableStakes}
- Stakes with neutral P&L: ${totalStakes - profitableStakes - unprofitableStakes}
`.trim();
} 