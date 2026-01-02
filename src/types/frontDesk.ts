export type PaymentMethod = 'transfer' | 'POS' | 'cash'
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
  discount_percent?: number;
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

export type FrontDeskRecordType = 'room_booking' | 'checkout_record' | 'guest_record'

export interface CheckoutData {
  checkout_date: string;
  total_due: number;
  final_payment: number;
  payment_method: PaymentMethod;
  notes?: string;
}

export interface FrontDeskRecordData {
  type: FrontDeskRecordType;
  front_desk_staff_id: string;
  guest?: GuestInfo;
  stay?: StayInfo;
  pricing?: PricingInfo;
  payment?: PaymentInfo;
  checkout?: CheckoutData; // For checkout records
  meta: MetaInfo;
}

export interface RoomStatus {
  id: string;
  room_number: string;
  room_name?: string;
  room_type?: string;
  price_per_night: number;
  status: 'available' | 'occupied' | 'reserved' | 'cleaning';
  current_guest?: string;
  check_out_date?: string;
}