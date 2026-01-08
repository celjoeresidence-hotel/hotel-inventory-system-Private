export type PaymentMethod = 'transfer' | 'POS' | 'cash'
export type PaymentType = 'full' | 'part'

export interface GuestInfo {
  full_name: string;
  phone: string;
  email?: string;
  id_reference?: string;
}

export type GuestLifecycleStatus = 
  | 'reserved' 
  | 'checked_in' 
  | 'extended' 
  | 'transferred' 
  | 'checked_out' 
  | 'interrupted' 
  | 'canceled_voluntary' 
  | 'canceled_forced';

export interface StayInfo {
  room_id: string;
  check_in: string; // ISO date string
  check_out: string; // ISO date string
  adults: number;
  children: number;
  status?: GuestLifecycleStatus;
}

export interface PricingInfo {
  room_rate: number;
  nights: number;
  discount_percent?: number;
  discount_amount?: number;
  original_price?: number;
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

export type FrontDeskRecordType =
  | 'room_booking'
  | 'checkout_record'
  | 'guest_record'
  | 'room_reservation'
  | 'housekeeping_report'
  | 'stay_extension'
  | 'room_transfer'
  | 'stay_interruption'
  | 'refund_record'
  | 'penalty_fee'
  | 'payment_record'
  | 'discount_applied'
  | 'interrupted_stay_credit'
  | 'operational_note'

export interface CheckoutData {
  checkout_date: string;
  total_due: number;
  final_payment: number;
  payment_method: PaymentMethod;
  notes?: string;
}

export interface FrontDeskRecordData {
  type: FrontDeskRecordType;
  front_desk_staff_id?: string;
  guest?: GuestInfo;
  stay?: StayInfo;
  pricing?: PricingInfo;
  payment?: PaymentInfo;
  checkout?: CheckoutData; // For checkout records
  room_id?: string;
  room_number?: string;
  check_in_date?: string;
  check_out_date?: string;
  start_time?: string;
  end_time?: string;
  
  // Extension & Transfer Data
  extension?: {
      previous_check_out: string;
      new_check_out: string;
      nights_added: number;
      additional_cost: number;
      reason?: string;
  };
  transfer?: {
      previous_room_id: string;
      new_room_id: string;
      transfer_date: string;
      reason?: string;
      refund_amount?: number;
      new_charge_amount?: number;
  };

  meta?: MetaInfo;
  // Legacy/Flexible fields
  [key: string]: unknown; 
}

export interface RoomStatus {
  id: string;
  room_number: string;
  room_name?: string;
  room_type?: string;
  price_per_night: number;
  status: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance' | 'pending';
  current_guest?: string;
  check_out_date?: string;
  housekeeping_status: 'clean' | 'dirty' | 'not_reported' | 'inspected';
  upcoming_reservation?: {
    guest_name: string;
    check_in: string;
    check_out: string;
  };
  interrupted?: boolean;
  pending_resumption?: boolean;
}

// Phase 4: Ledger & Payments
export type TransactionType = 'debit' | 'credit'; // debit = charge (increases balance), credit = payment (decreases balance)
export type LedgerCategory = 'room_charge' | 'service_fee' | 'penalty' | 'payment' | 'refund' | 'discount' | 'deposit';

export interface LedgerEntry {
  id: string; // Record ID
  date: string;
  type: TransactionType;
  category: LedgerCategory;
  amount: number;
  description: string;
  reference_id?: string; // Optional external reference
  staff_id?: string;
}

export interface LedgerSummary {
  totalCharges: number; // Sum of debits
  totalPayments: number; // Sum of credits
  balance: number; // totalCharges - totalPayments
}

// Phase 1: Stay Segments (logical, append-only)
export interface StaySegment {
  stay_id: string;
  room_id: string;
  start_datetime: string;
  end_datetime: string;
  rate_at_time: number;
  reason: 'initial' | 'autobill_extension' | 'room_change_extension' | 'transfer';
  housekeeping_required?: boolean;
}
