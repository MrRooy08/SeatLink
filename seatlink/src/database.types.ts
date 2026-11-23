type Relationship<Name extends string, Column extends string, Parent extends string> = {
  foreignKeyName: Name
  columns: [Column]
  isOneToOne: false
  referencedRelation: Parent
  referencedColumns: ['id']
}

type Table<Row, Insert, Relationships extends unknown[] = []> = {
  Row: Row
  Insert: Insert
  Update: Partial<Insert>
  Relationships: Relationships
}

export type SeatStatus = 'AVAILABLE' | 'LOCKED' | 'UNAVAILABLE'
export type SeatLabel = 'A' | 'B' | 'C' | 'D'
export type DailySales = {
  branch_id: string; day: string; timezone: string; currency: string; day_start: string; day_end: string; server_now: string
  total_minor: string; paid_orders: number; basis: 'GROSS'; mock_excluded: boolean; sandbox_orders: number; refunds_supported: false
}

export type MenuItem = {
  id: string
  branch_id: string
  name: string
  price_minor: number
  currency: string
  available: boolean
  is_demo?: boolean
}

export type OrderItem = {
  order_id: string
  menu_item_id: string
  name: string
  unit_price_minor: number
  quantity: number
}

export type SalesOrder = {
  id: string
  branch_id: string
  created_by: string
  status: 'DRAFT' | 'PENDING' | 'CANCELLED' | 'EXPIRED' | 'PAID' | 'PAID_REVIEW'
  currency: string
  total_minor: number
  revision: number
  session_expires_at: string | null
  created_at: string
  updated_at: string
  selected_seat_ids: string[]
  station_id?: string
  paid_at?: string | null
  paid_attempt_id?: string | null
  checkout_step?: CheckoutStep
  draft_seat_ids?: string[]
  payment_method?: 'QR' | 'CASH' | null
  paid_method?: 'QR' | 'CASH' | null
}
export type CheckoutStep = 'MENU' | 'SEATS' | 'PAYMENT' | 'RESULT'
export type PreviewItem = { menu_item_id: string; name: string; quantity: number; unit_price_minor: number; currency: string }

export type PaymentAttempt = {
  id: string; order_id: string; provider: 'MOCK' | 'CASH' | 'TWO_C2P'; amount_minor: number; currency: string
  status: 'PENDING' | 'FAILED' | 'EXPIRED' | 'SUCCEEDED'
  qr_expires_at: string; created_at: string; succeeded_at: string | null
  mode?: 'MOCK' | 'CASH' | 'SANDBOX'
  provider_state?: 'CREATING' | 'UNKNOWN' | 'PENDING' | 'CLOSED' | 'SUCCEEDED'
  qr_image_url?: string | null
  provider_qr_expires_at?: string | null
  qr_issue?: string | null
  cash_received_minor?: number | null
  cash_change_minor?: number | null
}
export type SeatUse = {
  id: string; order_id: string; seat_id: string; started_at: string; expires_at: string
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED'; ended_at: string | null
  label: SeatLabel; table_number: number
}
export type PaymentException = {
  id: string; order_id: string; payment_attempt_id: string; kind: 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT'
  created_at: string; reviewed_at: string | null; owner_note: string | null
}
export type DisplaySnapshot = {
  server_now: string; station_id: string; station_name: string; branch: string
  tables: { id?: string; table_number: number; seats: { id?: string; label: SeatLabel; status: SeatStatus; current_order?: boolean }[] }[]
  order: {
    reference: string; status: SalesOrder['status']; total_minor: number; currency: string
    session_expires_at: string | null; payment_status: PaymentAttempt['status'] | null
    checkout_step?: CheckoutStep; payment_method?: 'QR' | 'CASH' | null; paid_method?: 'QR' | 'CASH' | null
    qr_image_url?: string | null; payment_mode?: 'MOCK' | 'CASH' | 'SANDBOX' | null
    payment_attempt_id?: string | null; provider_qr_expires_at?: string | null
    qr_expires_at: string | null; qr_text: string | null
    items: { name: string; quantity: number; unit_price_minor: number }[]
    selected_seats: { label: SeatLabel; table_number: number }[]
    allocations: { label: SeatLabel; table_number: number; expires_at: string }[]
  } | null
}

export type SalesSnapshot = {
  server_now: string
  menu: MenuItem[]
  order: (SalesOrder & { items: OrderItem[] }) | null
  tables: {
    id: string
    table_number: number
    seats: { id: string; label: SeatLabel; status: SeatStatus; locked_order_id: string | null }[]
  }[]
  history: Pick<SalesOrder, 'id' | 'status' | 'currency' | 'total_minor' | 'created_at' | 'session_expires_at'>[]
  station?: { id: string; name: string }
  operator?: { role: 'OWNER'; role_label: string }
  development_enabled?: boolean
  attempts?: PaymentAttempt[]
  recent_attempts?: PaymentAttempt[]
  allocations?: SeatUse[]
  exceptions?: PaymentException[]
  audit?: { id: string; order_id: string | null; action: string; created_at: string; details: Record<string, unknown> }[]
  cart_preview?: PreviewItem[]
  cart_revision?: number
  cart_total_minor?: number
  display_last_seen_at?: string | null
  payment_mode?: 'MOCK' | 'SANDBOX' | 'UNCONFIGURED' | 'DISABLED'
  unresolved_qr?: number
  qr_configuration?: 'READY' | 'MOCK_ACCESS_DISABLED' | 'SANDBOX_MERCHANT_MISSING' | 'QR_DISABLED'
}

type DraftItems = { menu_item_id: string; quantity: number }[]

export type Database = {
  public: {
    Tables: {
      menu_items: Table<MenuItem, Omit<MenuItem, 'id'> & { id?: string },
        [Relationship<'menu_items_branch_id_fkey', 'branch_id', 'branches'>]>
      orders: Table<SalesOrder, SalesOrder,
        [Relationship<'orders_branch_id_fkey', 'branch_id', 'branches'>]>
      order_items: Table<OrderItem, OrderItem,
        [Relationship<'order_items_order_id_fkey', 'order_id', 'orders'>,
         Relationship<'order_items_menu_item_id_fkey', 'menu_item_id', 'menu_items'>]>
      organisations: Table<{ id: string; name: string }, { id?: string; name: string }>
      owner_memberships: Table<
        { user_id: string; organisation_id: string; role: 'OWNER' },
        { user_id: string; organisation_id: string; role?: 'OWNER' },
        [Relationship<'owner_memberships_organisation_id_fkey', 'organisation_id', 'organisations'>]
      >
      branches: Table<
        { id: string; organisation_id: string; name: string; address: string | null; timezone: string; currency: string | null },
        { id?: string; organisation_id: string; name: string; address?: string | null; timezone?: string; currency?: string | null },
        [Relationship<'branches_organisation_id_fkey', 'organisation_id', 'organisations'>]
      >
      tables: Table<
        { id: string; branch_id: string; table_number: number },
        { id?: string; branch_id: string; table_number: number },
        [Relationship<'tables_branch_id_fkey', 'branch_id', 'branches'>]
      >
      seats: Table<
        { id: string; table_id: string; label: SeatLabel; status: SeatStatus; locked_order_id: string | null },
        { id?: string; table_id: string; label: SeatLabel; status?: SeatStatus; locked_order_id?: string | null },
        [Relationship<'seats_table_id_fkey', 'table_id', 'tables'>]
      >
    }
    Views: Record<never, never>
    Functions: {
      read_branch_sales: { Args: { p_branch_id: string }; Returns: SalesSnapshot }
      read_branch_daily_sales: { Args: { p_branch_id: string }; Returns: DailySales }
      save_draft_order: {
        Args: { p_order_id: string; p_branch_id: string; p_revision: number; p_request_id: string; p_items: DraftItems }
        Returns: SalesOrder
      }
      confirm_order_seats: {
        Args: { p_order_id: string; p_revision: number; p_seat_ids: string[] }
        Returns: SalesOrder
      }
      cancel_order: { Args: { p_order_id: string }; Returns: SalesOrder }
      create_mock_payment: { Args: { p_order_id: string; p_request_id: string }; Returns: PaymentAttempt }
      prepare_mock_qr: { Args: { p_order_id: string; p_request_id: string }; Returns: PaymentAttempt }
      simulate_mock_payment: { Args: { p_attempt_id: string; p_event_id: string; p_result: 'SUCCESS' | 'FAILURE' }; Returns: SalesOrder }
      release_seat_use: { Args: { p_order_id: string; p_session_ids: string[] }; Returns: undefined }
      simulate_extension: { Args: { p_session_id: string; p_request_id: string; p_additional_seconds: number }; Returns: string }
      extend_seat_use: { Args: { p_device_token: string; p_request_id: string; p_seat_id: string; p_session_id: string; p_additional_seconds: number }; Returns: string }
      pair_customer_display: { Args: { p_station_id: string }; Returns: string }
      read_customer_display: { Args: { p_token: string }; Returns: DisplaySnapshot }
      start_next_sale: { Args: { p_station_id: string }; Returns: undefined }
      record_payment_follow_up: { Args: { p_exception_id: string; p_note: string }; Returns: undefined }
      update_cart_preview: { Args: { p_station_id: string; p_revision: number; p_items: DraftItems }; Returns: { items: PreviewItem[]; revision: number; total_minor: number; currency: string | null } }
      continue_to_seats: { Args: { p_order_id: string; p_branch_id: string; p_revision: number; p_request_id: string; p_items: DraftItems }; Returns: SalesOrder }
      change_draft_step: { Args: { p_order_id: string; p_step: 'MENU' | 'SEATS' }; Returns: SalesOrder }
      update_selected_seats: { Args: { p_order_id: string; p_seat_ids: string[] }; Returns: undefined }
      select_payment_method: { Args: { p_order_id: string; p_method: 'QR' | 'CASH' }; Returns: SalesOrder }
      confirm_cash_payment: { Args: { p_order_id: string; p_request_id: string; p_received_minor: number }; Returns: SalesOrder }
      resolve_mock_attempt: { Args: { p_attempt_id: string }; Returns: undefined }
      begin_sandbox_payment: { Args: { p_order_id: string; p_request_id: string }; Returns: PaymentAttempt }
    }
    Enums: { seat_status: SeatStatus }
  }
}
