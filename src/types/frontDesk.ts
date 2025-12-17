export type PaymentMethod = 'transfer' | 'POS';

export interface GuestInfo {
  full_name: string;
  phone: string;
}

export interface StayInfo {
  room_id: string;
  check_in: string; // ISO date string
  check_out: string; // ISO date string
  adults: number;
  children: number;
}

export interface PricingInfo {
  room_rate: number;
  nights: number;
  total_room_cost: number;
}

export interface PaymentInfo {
  paid_amount: number;
  payment_method: PaymentMethod;
  payment_reference: string | null;
  balance: number;
}

export interface MetaInfo {
  notes: string | null;
  created_at_local: string; // ISO datetime string
}

export interface FrontDeskRecordData {
  guest: GuestInfo;
  stay: StayInfo;
  pricing: PricingInfo;
  payment: PaymentInfo;
  meta: MetaInfo;
}