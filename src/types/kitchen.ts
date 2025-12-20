export interface KitchenStockData {
  date: string;
  item_name: string;
  opening_stock: number;
  restocked: number;
  sold: number;
  closing_stock: number;
  // Read-only in UI, carried from Inventory Setup
  unit_price?: number;
  // Computed in UI: sold × unit_price
  total_amount?: number;
  notes?: string;
}