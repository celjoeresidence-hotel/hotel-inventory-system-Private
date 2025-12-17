export interface KitchenStockData {
  date: string;
  item_name: string;
  opening_stock: number;
  restocked: number;
  sold: number;
  closing_stock: number;
  notes?: string;
}