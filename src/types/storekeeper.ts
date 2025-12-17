export interface StorekeeperStockData {
  date: string;
  item_name: string;
  opening_stock: number;
  restocked: number;
  issued: number;
  closing_stock: number;
  notes?: string;
}