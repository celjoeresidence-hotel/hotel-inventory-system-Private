export type PaymentMethod = 'transfer' | 'POS'
export type PaymentType = 'full' | 'part'

export interface GuestInfo {
  full_name: string;
  phone: string;
  email?: string;
  id_reference?: string;
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
  payment_type: PaymentType;
  payment_date: string; // ISO date string
  payment_reference: string | null;
  balance: number;
}

export interface MetaInfo {
  notes: string | null;
  created_at_local: string; // ISO datetime string
}

export type FrontDeskRecordType = 'room_booking'

export interface FrontDeskRecordData {
  type: FrontDeskRecordType;
  front_desk_staff_id: string;
  guest: GuestInfo;
  stay: StayInfo;
  pricing: PricingInfo;
  payment: PaymentInfo;
  meta: MetaInfo;
}