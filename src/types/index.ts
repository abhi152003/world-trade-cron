export interface Subscriber {
  username: string;
  address: string;
  subscribedAt: Date;
}

export interface Influencer {
  _id: string;
  image: string;
  name: string;
  subscribers?: Subscriber[];
}

export interface BacktestingSignal {
  _id: string;
  "Twitter Account": string;
  "Tweet": string;
  "Tweet Date": string | Date;
  "Signal Generation Date": string | Date;
  "Signal Message": string;
  "Token Mentioned": string;
  "Token ID": string;
  "Price at Tweet": string;
  "Current Price": string;
  "TP1": string;
  "TP2": string;
  "SL": string;
  "Exit Price": string;
  "P&L": string;
  "Max Exit Time": string | Date;
  "backtesting_done": boolean;
  "Exit Price (Trailing Stop)": number;
  "P&L (Trailing Stop)": string;
  "Exit Price (SMA10)": number;
  "P&L (SMA10)": string;
  "Exit Price (SMA20)": number;
  "P&L (SMA20)": string;
  "Exit Price (EMA10)": number;
  "P&L (EMA10)": string;
  "Exit Price (EMA20)": number;
  "P&L (EMA20)": string;
  "Exit Price (Dynamic TP/SL)": number;
  "P&L (Dynamic TP/SL)": string;
  "Final Exit Price": number;
  "Final P&L": string;
  "Best Strategy": string;
  "Reasoning": string;
  "IPFS Link": string;
}

export interface ProcessedSignal {
  subscriberAddress: string;
  influencerName: string;
  signalId: string;
  finalPnL: string;
  signalGenerationDate: Date;
  subscribedAt: Date;
}

export interface ContractStakeDetails {
  amount: bigint;
  timestamp: bigint;
  tradingAmount: bigint;
  currentTradeValue: bigint;
  tradeActive: boolean;
  claimableRewards: bigint;
  active: boolean;
}

// New types for tracking processed signals
export interface ProcessedSignalRecord {
  subscriberAddress: string;
  signalId: string;
  influencerName: string;
  finalPnL: string;
  processedAt: Date;
  signalGenerationDate: Date;
}

export interface UserSignalSummary {
  subscriberAddress: string;
  totalSignalsProcessed: number;
  totalPnLPercentage: number;
  lastProcessedAt: Date;
  lastSignalDate?: Date;
}

export interface UserTradeValueUpdate {
  subscriberAddress: string;
  stakeIndex: number;
  originalTradingAmount: string;
  newTradeValue: string;
  pnlPercentage: string;
  updatedAt: Date;
  blockchainTxHash?: string;
} 