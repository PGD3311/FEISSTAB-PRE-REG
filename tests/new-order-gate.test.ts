import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkNewOrderGate,
  userClientNewOrderReader,
  type NewOrderReader
} from '@/app/_payments/new-order-gate'
import {
  NEW_ORDER_CHECK_FAILED_MESSAGE,
  reviewMessage,
  type PaymentReview
} from '@/lib/payment-review-messages'

function review(overrides: Partial<PaymentReview> = {}): PaymentReview {
  return {
    registration_id: 'paid-1',
    support_ref: 'PAY-7KQ2M',
    message_code: 'A',
    created_at: '2026-10-16T12:00:00+00:00',
    resolved: false,
    ...overrides
  }
}

/** A reader with fakes for the three reads; each can be overridden, and every call is recorded */
function fakeReader(overrides: Partial<NewOrderReader> = {}) {
  const reader = {
    orderFeis: vi.fn(async (): Promise<string | null> => 'feis-1'),
    familyOrderIds: vi.fn(async (): Promise<string[]> => ['paid-1', 'held-1']),
    reviews: vi.fn(async (): Promise<PaymentReview[]> => []),
    ...overrides
  }
  return reader
}

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorLog.mockRestore()
})

describe('checkNewOrderGate', () => {
  it('refuses when a read fails, whichever one, because the gate cannot be judged', async () => {
    const failures: Partial<NewOrderReader>[] = [
      { orderFeis: vi.fn().mockRejectedValue(new Error('registrations unreadable')) },
      { familyOrderIds: vi.fn().mockRejectedValue(new Error('orders unreadable')) },
      { reviews: vi.fn().mockRejectedValue(new Error('reviews unreadable')) }
    ]
    for (const failure of failures) {
      errorLog.mockClear()
      const gate = await checkNewOrderGate(fakeReader(failure), { registrationId: 'held-1' })
      expect(gate).toEqual({ allowed: false, message: NEW_ORDER_CHECK_FAILED_MESSAGE })
      expect(errorLog).toHaveBeenCalledTimes(1)
    }
    // Submit names the feis, so only the other two reads can fail for it
    const gate = await checkNewOrderGate(
      fakeReader({ reviews: vi.fn().mockRejectedValue(new Error('reviews unreadable')) }),
      { feisListingId: 'feis-1' }
    )
    expect(gate).toEqual({ allowed: false, message: NEW_ORDER_CHECK_FAILED_MESSAGE })
  })

  it("allows an order that isn't this family's, and reads nothing more", async () => {
    // Pay then answers "not found" for it
    const reader = fakeReader({ orderFeis: vi.fn(async () => null) })
    const gate = await checkNewOrderGate(reader, { registrationId: 'someone-elses' })
    expect(gate).toEqual({ allowed: true })
    expect(reader.orderFeis).toHaveBeenCalledWith('someone-elses')
    expect(reader.familyOrderIds).not.toHaveBeenCalled()
    expect(reader.reviews).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('refuses with message A and its reference while a case is open on the feis', async () => {
    const message = reviewMessage('A', 'PAY-7KQ2M')
    const open = [review({ registration_id: 'paid-1' })]

    // Pay for the held order: the case is on the family's paid order for the same feis
    const pay = fakeReader({ reviews: vi.fn(async () => open) })
    expect(await checkNewOrderGate(pay, { registrationId: 'held-1' })).toEqual({
      allowed: false,
      message
    })
    expect(pay.orderFeis).toHaveBeenCalledWith('held-1')
    expect(pay.familyOrderIds).toHaveBeenCalledWith('feis-1')
    expect(message).toContain('PAY-7KQ2M')
    expect(message).toContain("Please don't pay again")

    // Submit, which names the feis: no order lookup is needed
    const submit = fakeReader({ reviews: vi.fn(async () => open) })
    expect(await checkNewOrderGate(submit, { feisListingId: 'feis-1' })).toEqual({
      allowed: false,
      message
    })
    expect(submit.orderFeis).not.toHaveBeenCalled()
    expect(submit.familyOrderIds).toHaveBeenCalledWith('feis-1')
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('names the newest open case when there are several', async () => {
    const reader = fakeReader({
      reviews: vi.fn(async () => [
        review({ support_ref: 'PAY-OLDER', created_at: '2026-10-15T12:00:00+00:00' }),
        review({ support_ref: 'PAY-NEWER', registration_id: 'held-1' })
      ])
    })
    const gate = await checkNewOrderGate(reader, { feisListingId: 'feis-1' })
    expect(gate).toEqual({ allowed: false, message: reviewMessage('A', 'PAY-NEWER') })
  })

  it('allows a new order once the case is resolved', async () => {
    const reader = fakeReader({ reviews: vi.fn(async () => [review({ resolved: true })]) })
    expect(await checkNewOrderGate(reader, { registrationId: 'held-1' })).toEqual({ allowed: true })
    expect(await checkNewOrderGate(reader, { feisListingId: 'feis-1' })).toEqual({ allowed: true })
  })

  it("isn't stopped by a message-B case, or by a case on an order of another feis", async () => {
    const messageB = fakeReader({
      reviews: vi.fn(async () => [review({ message_code: 'B' })])
    })
    expect(await checkNewOrderGate(messageB, { feisListingId: 'feis-1' })).toEqual({
      allowed: true
    })

    // familyOrderIds is for this feis only, so a case on another feis's order isn't among them
    const otherFeis = fakeReader({
      reviews: vi.fn(async () => [review({ registration_id: 'paid-at-feis-2' })])
    })
    expect(await checkNewOrderGate(otherFeis, { feisListingId: 'feis-1' })).toEqual({
      allowed: true
    })
  })

  it('allows a family with no case at all', async () => {
    expect(await checkNewOrderGate(fakeReader(), { registrationId: 'held-1' })).toEqual({
      allowed: true
    })
  })
})

/** A stand-in for the user's Supabase client that records each query and answers from `answers` */
function fakeClient(answers: {
  registration?: { data: unknown; error: unknown }
  orders?: { data: unknown; error: unknown }
  rpc?: { data: unknown; error: unknown }
}) {
  const calls: string[] = []
  const client = {
    from(table: string) {
      calls.push(`from ${table}`)
      let single = false
      const builder = {
        select(columns: string) {
          calls.push(`select ${columns}`)
          return builder
        },
        eq(column: string, value: string) {
          calls.push(`eq ${column} ${value}`)
          return builder
        },
        maybeSingle() {
          single = true
          calls.push('maybeSingle')
          return builder
        },
        then(resolve: (value: unknown) => unknown) {
          resolve(single ? answers.registration : answers.orders)
        }
      }
      return builder
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(`rpc ${fn} ${JSON.stringify(args)}`)
      return Promise.resolve(answers.rpc)
    }
  }
  return { client: client as unknown as Parameters<typeof userClientNewOrderReader>[0], calls }
}

describe('userClientNewOrderReader', () => {
  it("looks an order up by id and household, so only the family's own order is found", async () => {
    const found = fakeClient({ registration: { data: { feis_listing_id: 'feis-1' }, error: null } })
    expect(await userClientNewOrderReader(found.client, 'house-1').orderFeis('o1')).toBe('feis-1')
    expect(found.calls).toEqual([
      'from registrations',
      'select feis_listing_id',
      'eq id o1',
      'eq household_id house-1',
      'maybeSingle'
    ])

    const missing = fakeClient({ registration: { data: null, error: null } })
    expect(await userClientNewOrderReader(missing.client, 'house-1').orderFeis('o1')).toBeNull()
  })

  it("lists the family's orders for the feis, and reads all their payment cases", async () => {
    const { client, calls } = fakeClient({
      orders: { data: [{ id: 'paid-1' }, { id: 'held-1' }], error: null },
      rpc: { data: [review()], error: null }
    })
    const reader = userClientNewOrderReader(client, 'house-1')
    expect(await reader.familyOrderIds('feis-1')).toEqual(['paid-1', 'held-1'])
    expect(await reader.reviews()).toEqual([review()])
    expect(calls).toEqual([
      'from registrations',
      'select id',
      'eq feis_listing_id feis-1',
      'eq household_id house-1',
      'rpc get_my_payment_reviews {"p_registration_id":null}'
    ])
  })

  it('has nothing for a null result, and throws on an error so the gate refuses', async () => {
    const empty = fakeClient({
      orders: { data: null, error: null },
      rpc: { data: null, error: null }
    })
    const reader = userClientNewOrderReader(empty.client, 'house-1')
    expect(await reader.familyOrderIds('feis-1')).toEqual([])
    expect(await reader.reviews()).toEqual([])

    const broken = userClientNewOrderReader(
      fakeClient({
        registration: { data: null, error: new Error('no') },
        orders: { data: null, error: new Error('no') },
        rpc: { data: null, error: new Error('no') }
      }).client,
      'house-1'
    )
    await expect(broken.orderFeis('o1')).rejects.toThrow('no')
    await expect(broken.familyOrderIds('feis-1')).rejects.toThrow('no')
    await expect(broken.reviews()).rejects.toThrow('no')
  })
})
