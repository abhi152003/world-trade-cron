import { Influencer, BacktestingSignal, ProcessedSignal, ProcessedSignalRecord } from '../types/index.js';
import databaseManager from './database.js';

/**
 * Processes signals for a specific subscriber and influencer combination
 * Only processes signals within the first 7 days of subscription
 */
export function processSubscriberSignals(
  subscriber: any,
  influencer: Influencer,
  signals: BacktestingSignal[]
): ProcessedSignal[] {
  const subscribedAt = new Date(subscriber.subscribedAt);
  const sevenDaysAfterSubscription = new Date(subscribedAt.getTime() + (7 * 24 * 60 * 60 * 1000));
  const processedSignals: ProcessedSignal[] = [];

  for (const signal of signals) {
    const signalGenerationDate = new Date(signal["Signal Generation Date"]);
    
    // Only include signals generated within first 7 days of subscription
    if (signalGenerationDate > subscribedAt && signalGenerationDate <= sevenDaysAfterSubscription) {
      processedSignals.push({
        subscriberAddress: subscriber.address,
        influencerName: influencer.name,
        signalId: signal._id,
        finalPnL: signal["Final P&L"],
        signalGenerationDate,
        subscribedAt
      });
    }
  }

  return processedSignals;
}

/**
 * Calculates the total sum P&L for a set of signals (instead of average)
 */
export function calculateTotalSumPnL(signals: ProcessedSignal[]): string {
  if (signals.length === 0) {
    return "0%";
  }

  let totalPnL = 0;
  let validSignalsCount = 0;

  for (const signal of signals) {
    try {
      // Parse the P&L percentage (remove % sign and convert to number)
      const pnlValue = parseFloat(signal.finalPnL.replace('%', ''));
      
      if (!isNaN(pnlValue)) {
        totalPnL += pnlValue;
        validSignalsCount++;
      }
    } catch (error) {
      console.warn(`Invalid P&L value for signal ${signal.signalId}: ${signal.finalPnL}`);
    }
  }

  if (validSignalsCount === 0) {
    return "0%";
  }

  return `${totalPnL.toFixed(2)}%`;
}

/**
 * Groups processed signals by subscriber address
 */
export function groupSignalsBySubscriber(signals: ProcessedSignal[]): Map<string, ProcessedSignal[]> {
  const signalsBySubscriber = new Map<string, ProcessedSignal[]>();

  for (const signal of signals) {
    const address = signal.subscriberAddress;
    
    if (!signalsBySubscriber.has(address)) {
      signalsBySubscriber.set(address, []);
    }
    
    signalsBySubscriber.get(address)!.push(signal);
  }

  return signalsBySubscriber;
}

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
 * Filters out signals that have already been processed for a specific subscriber
 */
export async function filterUnprocessedSignals(
  subscriberAddress: string,
  signals: BacktestingSignal[]
): Promise<BacktestingSignal[]> {
  try {
    console.log(`\n=== DEBUGGING SIGNAL FILTERING FOR ${subscriberAddress} ===`);
    console.log(`Total signals to check: ${signals.length}`);
    
    if (signals.length > 0) {
      console.log(`Sample signal IDs from backtesting DB:`, signals.slice(0, 3).map(s => ({
        id: s._id.toString(),
        account: s["Twitter Account"],
        date: s["Signal Generation Date"]
      })));
    }
    
    // Get already processed signal IDs for this subscriber (returns Set<string>)
    const processedSignalIds = await databaseManager.getProcessedSignalIds(subscriberAddress);
    
    console.log(`Processed signal IDs from tracking DB:`, Array.from(processedSignalIds).slice(0, 3));
    
    // Filter out already processed signals by converting ObjectIds to strings
    const unprocessedSignals = signals.filter(signal => {
      const signalIdString = signal._id.toString();
      const isProcessed = processedSignalIds.has(signalIdString);
      if (isProcessed) {
        console.log(`SKIPPING processed signal: ${signalIdString} (${signal["Twitter Account"]})`);
      }
      return !isProcessed;
    });
    
    console.log(`RESULT: ${unprocessedSignals.length} unprocessed out of ${signals.length} total`);
    
    if (unprocessedSignals.length > 0) {
      console.log(`Unprocessed signal IDs:`, unprocessedSignals.slice(0, 3).map(s => ({
        id: s._id.toString(),
        account: s["Twitter Account"],
        date: s["Signal Generation Date"]
      })));
    }
    
    console.log(`=== END DEBUGGING FOR ${subscriberAddress} ===\n`);
    
    return unprocessedSignals;
  } catch (error) {
    console.error(`Error filtering unprocessed signals for ${subscriberAddress}:`, error);
    return signals; // Return all signals if filtering fails
  }
}

/**
 * Main function to process all influencers and their signals
 * Only processes new signals that haven't been processed before
 */
export async function processAllInfluencerSignals(
  influencers: Influencer[],
  signalsMap: Map<string, BacktestingSignal[]>
): Promise<Map<string, { signals: ProcessedSignal[]; totalSumPnL: string; newSignalsCount: number }>> {
  const subscriberResults = new Map<string, { signals: ProcessedSignal[]; totalSumPnL: string; newSignalsCount: number }>();
  
  for (const influencer of influencers) {
    const influencerSignals = signalsMap.get(influencer.name) || [];
    const validSignals = filterValidSignals(influencerSignals);
    
    console.log(
      `Processing ${influencer.name}: ${validSignals.length} valid signals out of ${influencerSignals.length} total`
    );
    
    // Check if influencer has subscribers
    if (!influencer.subscribers || !Array.isArray(influencer.subscribers)) {
      console.log(`Skipping ${influencer.name}: no subscribers array found`);
      continue;
    }
    
    for (const subscriber of influencer.subscribers) {
      try {
        const subscribedAt = new Date(subscriber.subscribedAt);
        const sevenDaysAfterSubscription = new Date(subscribedAt.getTime() + (7 * 24 * 60 * 60 * 1000));
        
        // Filter signals to only include those within first 7 days of subscription
        const relevantSignals = validSignals.filter(signal => {
          const signalGenerationDate = new Date(signal["Signal Generation Date"]);
          return signalGenerationDate > subscribedAt && signalGenerationDate <= sevenDaysAfterSubscription;
        });
        
        if (relevantSignals.length === 0) {
          console.log(`No relevant signals for ${subscriber.address} from ${influencer.name} within first 7 days of subscription`);
          continue;
        }
        
        // Filter out already processed signals for this subscriber
        const unprocessedSignals = await filterUnprocessedSignals(subscriber.address, relevantSignals);
        
        if (unprocessedSignals.length === 0) {
          console.log(`No new signals to process for ${subscriber.address} from ${influencer.name} within 7-day window`);
          continue;
        }
        
        // Process only the new unprocessed signals within 7-day window
        const subscriberSignals = processSubscriberSignals(subscriber, influencer, unprocessedSignals);
        
        if (subscriberSignals.length > 0) {
          const subscribedAt = new Date(subscriber.subscribedAt);
          const sevenDaysAfter = new Date(subscribedAt.getTime() + (7 * 24 * 60 * 60 * 1000));
          console.log(`Processing signals for ${subscriber.address} subscribed on ${subscribedAt.toISOString()}, 7-day window ends ${sevenDaysAfter.toISOString()}`);
          
          // Get existing user summary to calculate cumulative total
          const existingSummary = await databaseManager.getUserSignalSummary(subscriber.address);
          const existingTotalPnL = existingSummary ? existingSummary.totalPnLPercentage : 0;
          
          // Calculate P&L for new signals only
          const newSignalsPnL = calculateTotalSumPnL(subscriberSignals);
          const newSignalsPnLValue = parseFloat(newSignalsPnL.replace('%', ''));
          
          // Calculate cumulative total P&L
          const cumulativeTotalPnL = existingTotalPnL + newSignalsPnLValue;
          const cumulativeTotalPnLString = `${cumulativeTotalPnL.toFixed(2)}%`;
          
          // Store results
          subscriberResults.set(subscriber.address, {
            signals: subscriberSignals,
            totalSumPnL: cumulativeTotalPnLString,
            newSignalsCount: subscriberSignals.length
          });
          
          // Mark these signals as processed in the database
          const processedSignalRecords: ProcessedSignalRecord[] = subscriberSignals.map(signal => ({
            subscriberAddress: signal.subscriberAddress,
            signalId: signal.signalId,
            influencerName: signal.influencerName,
            finalPnL: signal.finalPnL,
            processedAt: new Date(),
            signalGenerationDate: signal.signalGenerationDate
          }));
          
          await databaseManager.markSignalsAsProcessed(subscriber.address, processedSignalRecords);
          
          console.log(
            `Subscriber ${subscriber.address} (${subscriber.username}) from ${influencer.name}: ` +
            `${subscriberSignals.length} new signals processed (within 7-day window), ` +
            `new P&L: ${newSignalsPnL}, cumulative total P&L: ${cumulativeTotalPnLString}`
          );
        }
      } catch (error) {
        console.error(`Error processing signals for subscriber ${subscriber.address} from ${influencer.name}:`, error);
      }
    }
  }
  
  return subscriberResults;
}

/**
 * Generates a summary report of processed signals
 */
export function generateProcessingSummary(
  subscriberResults: Map<string, { signals: ProcessedSignal[]; totalSumPnL: string; newSignalsCount: number }>
): string {
  const totalSubscribers = subscriberResults.size;
  let totalNewSignals = 0;
  let profitableSubscribers = 0;
  let unprofitableSubscribers = 0;
  
  for (const [address, result] of subscriberResults) {
    totalNewSignals += result.newSignalsCount;
    
    const totalPnL = parseFloat(result.totalSumPnL.replace('%', ''));
    if (totalPnL > 0) {
      profitableSubscribers++;
    } else if (totalPnL < 0) {
      unprofitableSubscribers++;
    }
  }
  
  return `
Processing Summary (7-day window from subscription):
- Total subscribers with new signals: ${totalSubscribers}
- Total new signals processed: ${totalNewSignals}
- Subscribers with positive cumulative P&L: ${profitableSubscribers}
- Subscribers with negative cumulative P&L: ${unprofitableSubscribers}
- Subscribers with neutral cumulative P&L: ${totalSubscribers - profitableSubscribers - unprofitableSubscribers}
`.trim();
} 