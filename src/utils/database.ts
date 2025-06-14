import { MongoClient, Db, Collection } from 'mongodb';
import { Influencer, BacktestingSignal, ProcessedSignalRecord, UserSignalSummary, UserTradeValueUpdate, UserStakes, StakeRecord } from '../types/index.js';
import dotenv from 'dotenv';

dotenv.config();

class DatabaseManager {
  private client: MongoClient | null = null;
  private influencersDb: Db | null = null;
  private backtestingDb: Db | null = null;
  private signalTrackingDb: Db | null = null;
  private worldStakingDb: Db | null = null;

  constructor(private mongoUri: string) {}

  /**
   * Establishes connection to MongoDB
   */
  async connect(): Promise<void> {
    try {
      if (this.client) {
        return; // Already connected
      }

      console.log('Connecting to MongoDB...');
      this.client = new MongoClient(this.mongoUri);
      await this.client.connect();
      
      // Initialize database references
      this.influencersDb = this.client.db(process.env.INFLUENCERS_DB_NAME || 'influencers_db');
      this.backtestingDb = this.client.db(process.env.BACKTESTING_DB_NAME || 'backtesting_db');
      this.signalTrackingDb = this.client.db(process.env.SIGNAL_TRACKING_DB_NAME || 'signal_tracking_db');
      this.worldStakingDb = this.client.db(process.env.WORLD_STAKING_DB_NAME || 'world-staking');
      
      console.log('Successfully connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  /**
   * Closes the MongoDB connection
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
        this.influencersDb = null;
        this.backtestingDb = null;
        this.signalTrackingDb = null;
        this.worldStakingDb = null;
        console.log('Disconnected from MongoDB');
      }
    } catch (error) {
      console.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  /**
   * Gets the influencers collection
   */
  getInfluencersCollection(): Collection<Influencer> {
    if (!this.influencersDb) {
      throw new Error('Not connected to influencers database');
    }
    return this.influencersDb.collection<Influencer>('influencers');
  }

  /**
   * Gets the backtesting results collection
   */
  getBacktestingCollection(): Collection<BacktestingSignal> {
    if (!this.backtestingDb) {
      throw new Error('Not connected to backtesting database');
    }
    return this.backtestingDb.collection<BacktestingSignal>('backtesting_results_with_reasoning');
  }

  /**
   * Gets the processed signals collection for tracking
   */
  getProcessedSignalsCollection(): Collection<ProcessedSignalRecord> {
    if (!this.signalTrackingDb) {
      throw new Error('Not connected to signal tracking database');
    }
    return this.signalTrackingDb.collection<ProcessedSignalRecord>('processed_signals');
  }

  /**
   * Gets the user signal summary collection
   */
  getUserSignalSummaryCollection(): Collection<UserSignalSummary> {
    if (!this.signalTrackingDb) {
      throw new Error('Not connected to signal tracking database');
    }
    return this.signalTrackingDb.collection<UserSignalSummary>('user_signal_summary');
  }

  /**
   * Gets the trade value updates collection
   */
  getTradeValueUpdatesCollection(): Collection<UserTradeValueUpdate> {
    if (!this.signalTrackingDb) {
      throw new Error('Not connected to signal tracking database');
    }
    return this.signalTrackingDb.collection<UserTradeValueUpdate>('trade_value_updates');
  }

  /**
   * Gets the stakes collection from world-staking database
   */
  getStakesCollection(): Collection<UserStakes> {
    if (!this.worldStakingDb) {
      throw new Error('Not connected to world staking database');
    }
    return this.worldStakingDb.collection<UserStakes>('stakes');
  }

  /**
   * Retrieves all influencers with their subscribers
   */
  async getAllInfluencers(): Promise<Influencer[]> {
    try {
      const collection = this.getInfluencersCollection();
      const influencers = await collection.find({}).toArray();
      
      console.log(`Retrieved ${influencers.length} influencers from database`);
      
      // Debug: Log structure of first influencer to understand data format
      if (influencers.length > 0) {
        const firstInfluencer = influencers[0];
      }
      
      return influencers;
    } catch (error) {
      console.error('Error retrieving influencers:', error);
      throw error;
    }
  }

  /**
   * Gets processed signal IDs for a specific subscriber to avoid reprocessing
   */
  async getProcessedSignalIds(subscriberAddress: string): Promise<Set<string>> {
    try {
      console.log(`\n--- FETCHING PROCESSED SIGNALS FOR ${subscriberAddress} ---`);
      
      const collection = this.getProcessedSignalsCollection();
      const processedSignals = await collection.find(
        { subscriberAddress },
        { projection: { signalId: 1, influencerName: 1, processedAt: 1 } }
      ).toArray();
      
      // Convert ObjectIds to strings for comparison
      const signalIds = new Set(processedSignals.map(signal => signal.signalId.toString()));
      
      console.log(`Database query returned ${processedSignals.length} processed signals for ${subscriberAddress}`);
      
      if (processedSignals.length > 0) {
        console.log(`Sample processed signal records:`, processedSignals.slice(0, 3).map(s => ({
          signalId: s.signalId.toString(),
          influencer: s.influencerName,
          processedAt: s.processedAt
        })));
        console.log(`Processed signal IDs Set (strings):`, Array.from(signalIds).slice(0, 5));
      } else {
        console.log(`No processed signals found for ${subscriberAddress} in database`);
      }
      
      console.log(`--- END FETCH FOR ${subscriberAddress} ---\n`);
      
      return signalIds;
    } catch (error) {
      console.error(`Error retrieving processed signal IDs for ${subscriberAddress}:`, error);
      return new Set();
    }
  }

  /**
   * Marks signals as processed and updates user summary
   */
  async markSignalsAsProcessed(
    subscriberAddress: string,
    processedSignals: ProcessedSignalRecord[]
  ): Promise<void> {
    try {
      if (processedSignals.length === 0) {
        return;
      }

      const processedSignalsCollection = this.getProcessedSignalsCollection();
      const userSummaryCollection = this.getUserSignalSummaryCollection();

      // Insert processed signal records
      const insertResult = await processedSignalsCollection.insertMany(processedSignals);
      console.log(`Successfully inserted ${insertResult.insertedCount} processed signal records for ${subscriberAddress}`);

      // Calculate total P&L percentage for this batch
      const totalPnLPercentage = processedSignals.reduce((sum, signal) => {
        const pnlValue = parseFloat(signal.finalPnL.replace('%', ''));
        return sum + (isNaN(pnlValue) ? 0 : pnlValue);
      }, 0);

      // Get the latest signal date
      const latestSignalDate = new Date(Math.max(
        ...processedSignals.map(signal => signal.signalGenerationDate.getTime())
      ));

      // Update or create user signal summary
      const updateResult = await userSummaryCollection.updateOne(
        { subscriberAddress },
        {
          $inc: {
            totalSignalsProcessed: processedSignals.length,
            totalPnLPercentage: totalPnLPercentage
          },
          $set: {
            lastProcessedAt: new Date(),
            lastSignalDate: latestSignalDate
          }
        },
        { upsert: true }
      );

      console.log(`\n+++ SAVING PROCESSED SIGNALS FOR ${subscriberAddress} +++`);
      console.log(`Marked ${processedSignals.length} signals as processed for ${subscriberAddress}`);
      console.log(`Signal IDs being saved:`, processedSignals.map(s => s.signalId));
      console.log(`Signal details being saved:`, processedSignals.map(s => ({
        id: s.signalId,
        influencer: s.influencerName,
        pnl: s.finalPnL,
        date: s.signalGenerationDate
      })));
      console.log(`User summary update result:`, updateResult.modifiedCount > 0 ? 'updated' : 'created');
      
      // Verification: Check if signals were actually saved
      const verificationCount = await processedSignalsCollection.countDocuments({ subscriberAddress });
      console.log(`VERIFICATION: Total processed signals in DB for ${subscriberAddress}: ${verificationCount}`);
      
      // Check specifically for the signals we just saved (convert to strings for matching)
      const justSavedSignalIds = processedSignals.map(s => s.signalId);
      const savedSignalsCheck = await processedSignalsCollection.find(
        { 
          subscriberAddress,
          signalId: { $in: justSavedSignalIds }
        },
        { projection: { signalId: 1 } }
      ).toArray();
      
      console.log(`VERIFICATION: Found ${savedSignalsCheck.length} of ${justSavedSignalIds.length} just-saved signals in DB`);
      console.log(`+++ END SAVING FOR ${subscriberAddress} +++\n`);
    } catch (error) {
      console.error(`Error marking signals as processed for ${subscriberAddress}:`, error);
      throw error;
    }
  }

  /**
   * Gets user signal summary
   */
  async getUserSignalSummary(subscriberAddress: string): Promise<UserSignalSummary | null> {
    try {
      const collection = this.getUserSignalSummaryCollection();
      return await collection.findOne({ subscriberAddress });
    } catch (error) {
      console.error(`Error retrieving user signal summary for ${subscriberAddress}:`, error);
      return null;
    }
  }

  /**
   * Retrieves signals for a specific influencer after a given date
   */
  async getSignalsAfterDate(
    influencerName: string, 
    afterDate: Date
  ): Promise<BacktestingSignal[]> {
    try {
      const collection = this.getBacktestingCollection();
      
      const query = {
        "Twitter Account": influencerName,
        "Signal Generation Date": { $gt: afterDate },
        "backtesting_done": true,
        "Final P&L": { $exists: true, $ne: "" }
      };

      const signals = await collection.find(query).toArray();
      
      console.log(
        `Found ${signals.length} signals for ${influencerName} after ${afterDate.toISOString()}`
      );
      
      return signals;
    } catch (error) {
      console.error(`Error retrieving signals for ${influencerName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves signals for a specific influencer within a date range
   */
  async getSignalsInDateRange(
    influencerName: string, 
    fromDate: Date,
    toDate: Date
  ): Promise<BacktestingSignal[]> {
    try {
      const collection = this.getBacktestingCollection();
      
      const query = {
        "Twitter Account": influencerName,
        "Signal Generation Date": { 
          $gt: fromDate,
          $lte: toDate 
        },
        "backtesting_done": true,
        "Final P&L": { $exists: true, $ne: "" }
      };

      const signals = await collection.find(query).toArray();
      
      console.log(
        `Found ${signals.length} signals for ${influencerName} between ${fromDate.toISOString()} and ${toDate.toISOString()}`
      );
      
      return signals;
    } catch (error) {
      console.error(`Error retrieving signals for ${influencerName} in date range:`, error);
      throw error;
    }
  }

  /**
   * Gets signals for all influencers within the 7-day windows of subscriber dates
   */
  async getRelevantSignals(influencers: Influencer[]): Promise<Map<string, BacktestingSignal[]>> {
    const signalsMap = new Map<string, BacktestingSignal[]>();

    for (const influencer of influencers) {
      // Check if influencer has subscribers
      if (!influencer.subscribers || !Array.isArray(influencer.subscribers) || influencer.subscribers.length === 0) {
        console.log(`Skipping influencer ${influencer.name}: no subscribers found`);
        continue;
      }

      // Get all unique subscriber dates to find the earliest one
      const subscriberDates = influencer.subscribers.map(sub => {
        try {
          return new Date(sub.subscribedAt);
        } catch (error) {
          console.warn(`Invalid subscription date for subscriber ${sub.address} of ${influencer.name}`);
          return null;
        }
      }).filter(date => date !== null) as Date[];
      
      if (subscriberDates.length === 0) {
        console.log(`Skipping influencer ${influencer.name}: no valid subscription dates found`);
        continue;
      }

      // Find the earliest subscription date for this influencer
      const earliestSubscriptionDate = new Date(Math.min(...subscriberDates.map(date => date.getTime())));
      // Find the latest subscription date + 7 days to get the full range we need
      const latestSubscriptionDate = new Date(Math.max(...subscriberDates.map(date => date.getTime())));
      const latestPossibleSignalDate = new Date(latestSubscriptionDate.getTime() + (7 * 24 * 60 * 60 * 1000));
      
      try {
        // Get signals from earliest subscription to latest subscription + 7 days
        const signals = await this.getSignalsInDateRange(influencer.name, earliestSubscriptionDate, latestPossibleSignalDate);
        signalsMap.set(influencer.name, signals);
        console.log(`Retrieved ${signals.length} signals for ${influencer.name} in date range ${earliestSubscriptionDate.toISOString()} to ${latestPossibleSignalDate.toISOString()}`);
      } catch (error) {
        console.error(`Failed to get signals for influencer ${influencer.name}:`, error);
        // Continue with other influencers even if one fails
      }
    }

    return signalsMap;
  }

  /**
   * Gets all user stakes from the world-staking database
   */
  async getAllUserStakes(): Promise<UserStakes[]> {
    try {
      const collection = this.getStakesCollection();
      const userStakes = await collection.find({}).toArray();
      
      console.log(`Retrieved ${userStakes.length} users with stakes from world-staking database`);
      return userStakes;
    } catch (error) {
      console.error('Error retrieving user stakes:', error);
      throw error;
    }
  }

  /**
   * Gets stakes that have passed their exit timestamp
   */
  async getStakesReadyToExit(): Promise<{ userStakes: UserStakes; readyStakes: { index: number; stake: StakeRecord }[] }[]> {
    try {
      const allUserStakes = await this.getAllUserStakes();
      const currentTime = new Date();
      const readyToExitStakes: { userStakes: UserStakes; readyStakes: { index: number; stake: StakeRecord }[] }[] = [];

      for (const userStakes of allUserStakes) {
        const readyStakes: { index: number; stake: StakeRecord }[] = [];
        
        for (let i = 0; i < userStakes.stakes.length; i++) {
          const stake = userStakes.stakes[i];
          const exitTimestamp = new Date(stake.exitTimestamp);
          
          if (currentTime >= exitTimestamp) {
            readyStakes.push({ index: i, stake });
          }
        }

        if (readyStakes.length > 0) {
          readyToExitStakes.push({ userStakes, readyStakes });
        }
      }

      console.log(`Found ${readyToExitStakes.length} users with stakes ready to exit`);
      return readyToExitStakes;
    } catch (error) {
      console.error('Error getting stakes ready to exit:', error);
      throw error;
    }
  }

  /**
   * Gets signals for all influencers within stake time ranges
   */
  async getSignalsForStakeRanges(
    stakeRecords: { userStakes: UserStakes; readyStakes: { index: number; stake: StakeRecord }[] }[]
  ): Promise<Map<string, BacktestingSignal[]>> {
    const signalsMap = new Map<string, BacktestingSignal[]>();

    // Get all influencers first
    const influencers = await this.getAllInfluencers();

    for (const influencer of influencers) {
      // Collect all date ranges we need for this influencer
      const dateRanges: { fromDate: Date; toDate: Date }[] = [];

      for (const userStakeData of stakeRecords) {
        for (const readyStake of userStakeData.readyStakes) {
          const fromDate = new Date(readyStake.stake.timestamp);
          const toDate = new Date(readyStake.stake.exitTimestamp);
          dateRanges.push({ fromDate, toDate });
        }
      }

      if (dateRanges.length === 0) continue;

      try {
        // Find the overall min and max dates for this influencer
        const minDate = new Date(Math.min(...dateRanges.map(range => range.fromDate.getTime())));
        const maxDate = new Date(Math.max(...dateRanges.map(range => range.toDate.getTime())));

        // Get all signals in the overall range for efficiency
        const signals = await this.getSignalsInDateRange(influencer.name, minDate, maxDate);
        signalsMap.set(influencer.name, signals);
        
        console.log(`Retrieved ${signals.length} signals for ${influencer.name} in date range ${minDate.toISOString()} to ${maxDate.toISOString()}`);
      } catch (error) {
        console.error(`Failed to get signals for influencer ${influencer.name}:`, error);
      }
    }

    return signalsMap;
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      
      // Ping the database
      await this.client.db('admin').command({ ping: 1 });
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  /**
   * Debug method to check database state and identify potential issues
   */
  async debugDatabaseState(): Promise<void> {
    try {
      console.log('\n🔍 DATABASE STATE DEBUG 🔍');
      
      const processedSignalsCollection = this.getProcessedSignalsCollection();
      const userSummaryCollection = this.getUserSignalSummaryCollection();
      
      // Check total processed signals
      const totalProcessedSignals = await processedSignalsCollection.countDocuments({});
      console.log(`Total processed signals in database: ${totalProcessedSignals}`);
      
      // Check unique subscribers
      const uniqueSubscribers = await processedSignalsCollection.distinct('subscriberAddress');
      console.log(`Unique subscribers with processed signals: ${uniqueSubscribers.length}`);
      
      // Check for potential duplicates
      const duplicateCheck = await processedSignalsCollection.aggregate([
        {
          $group: {
            _id: {
              subscriberAddress: '$subscriberAddress',
              signalId: '$signalId'
            },
            count: { $sum: 1 }
          }
        },
        {
          $match: { count: { $gt: 1 } }
        }
      ]).toArray();
      
      if (duplicateCheck.length > 0) {
        console.log(`⚠️  Found ${duplicateCheck.length} potential duplicate signal-subscriber combinations:`);
        duplicateCheck.slice(0, 5).forEach(dup => {
          console.log(`  - Subscriber: ${dup._id.subscriberAddress}, Signal: ${dup._id.signalId}, Count: ${dup.count}`);
        });
      } else {
        console.log('✅ No duplicate signal-subscriber combinations found');
      }
      
      // Check user summaries
      const totalUserSummaries = await userSummaryCollection.countDocuments({});
      console.log(`Total user summaries: ${totalUserSummaries}`);
      
      // Sample some data
      const sampleProcessedSignals = await processedSignalsCollection.find({}).limit(3).toArray();
      if (sampleProcessedSignals.length > 0) {
        console.log('Sample processed signals:');
        sampleProcessedSignals.forEach(signal => {
          console.log(`  - ID: ${signal.signalId}, Subscriber: ${signal.subscriberAddress}, Influencer: ${signal.influencerName}`);
        });
      }
      
      console.log('🔍 END DATABASE DEBUG 🔍\n');
    } catch (error) {
      console.error('Error during database state debug:', error);
    }
  }

  /**
   * Stores trade value update record
   */
  async storeTradeValueUpdate(tradeUpdate: UserTradeValueUpdate): Promise<void> {
    try {
      const collection = this.getTradeValueUpdatesCollection();
      await collection.insertOne(tradeUpdate);
      console.log(`Stored trade value update for ${tradeUpdate.subscriberAddress}[${tradeUpdate.stakeIndex}]`);
    } catch (error) {
      console.error(`Error storing trade value update:`, error);
      throw error;
    }
  }

  /**
   * Gets the latest trade value for a user and stake index
   */
  async getLatestTradeValue(subscriberAddress: string, stakeIndex: number): Promise<UserTradeValueUpdate | null> {
    try {
      const collection = this.getTradeValueUpdatesCollection();
      return await collection.findOne(
        { subscriberAddress, stakeIndex },
        { sort: { updatedAt: -1 } }
      );
    } catch (error) {
      console.error(`Error getting latest trade value:`, error);
      return null;
    }
  }

  /**
   * Debug method to display current user signal summary
   */
  async debugUserSignalSummary(subscriberAddress: string): Promise<void> {
    try {
      console.log(`\n📊 USER SIGNAL SUMMARY DEBUG FOR ${subscriberAddress} 📊`);
      
      const userSummaryCollection = this.getUserSignalSummaryCollection();
      const summary = await userSummaryCollection.findOne({ subscriberAddress });
      
      if (summary) {
        console.log('Current user signal summary:');
        console.log(`- Subscriber Address: ${summary.subscriberAddress}`);
        console.log(`- Total Signals Processed: ${summary.totalSignalsProcessed}`);
        console.log(`- Total P&L Percentage: ${summary.totalPnLPercentage}%`);
        console.log(`- Last Processed At: ${summary.lastProcessedAt}`);
        console.log(`- Last Signal Date: ${summary.lastSignalDate}`);
      } else {
        console.log('No user signal summary found in database');
      }
      
      // Also check the processed signals for this user
      const processedSignalsCollection = this.getProcessedSignalsCollection();
      const processedSignalsCount = await processedSignalsCollection.countDocuments({ subscriberAddress });
      const sampleProcessedSignals = await processedSignalsCollection.find({ subscriberAddress }).limit(5).toArray();
      
      console.log(`\nProcessed signals for this user: ${processedSignalsCount}`);
      if (sampleProcessedSignals.length > 0) {
        console.log('Sample processed signals:');
        sampleProcessedSignals.forEach(signal => {
          console.log(`- Signal ID: ${signal.signalId}, P&L: ${signal.finalPnL}, Processed At: ${signal.processedAt}`);
        });
      }

      // Check trade value updates for this user
      const tradeValueUpdatesCollection = this.getTradeValueUpdatesCollection();
      const tradeValueUpdatesCount = await tradeValueUpdatesCollection.countDocuments({ subscriberAddress });
      const sampleTradeUpdates = await tradeValueUpdatesCollection.find({ subscriberAddress }).sort({ updatedAt: -1 }).limit(5).toArray();
      
      console.log(`\nTrade value updates for this user: ${tradeValueUpdatesCount}`);
      if (sampleTradeUpdates.length > 0) {
        console.log('Recent trade value updates:');
        sampleTradeUpdates.forEach(update => {
          console.log(`- Stake ${update.stakeIndex}: ${update.originalTradingAmount} -> ${update.newTradeValue} (${update.pnlPercentage})`);
        });
      }
      
      console.log('📊 END USER SIGNAL SUMMARY DEBUG 📊\n');
    } catch (error) {
      console.error('Error during user signal summary debug:', error);
    }
  }
}

// Validate MongoDB URI
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('MONGODB_URI environment variable is required');
}

// Create and export a singleton instance
export const databaseManager = new DatabaseManager(mongoUri);

export default databaseManager; 