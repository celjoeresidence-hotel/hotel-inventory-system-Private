export interface BarStockData {
  date: string;
  item_name: string;
  opening_stock: number;
  restocked: number;
  sold: number;
  closing_stock: number;
  unit_price: number;
  total_amount: number;
  notes?: string;
}