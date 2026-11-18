import { describe, expect, it } from 'vitest';
import { bestHowTo, itemWords, understand } from './supportBot';

describe('help bot understanding', () => {
  it('finds stock questions and the item words', () => {
    expect(understand('What is the stock of HP 680 ink?')).toEqual({ kind: 'stock', query: 'hp 680 ink' });
    expect(understand('how many logitech mouse do we have')).toEqual({ kind: 'stock', query: 'logitech mouse' });
    expect(understand('sandisk pen drive available?')).toEqual({ kind: 'stock', query: 'sandisk pen drive' });
    expect(itemWords('Stock of Dell 24" monitor please')).toEqual(['dell', '24', 'monitor']);
  });
  it('finds invoice numbers', () => {
    expect(understand('status of invoice INV-2026-27-0013')).toEqual({ kind: 'invoice', number: 'INV-2026-27-0013' });
    expect(understand('INV-0042 paid?')).toEqual({ kind: 'invoice', number: 'INV-0042' });
    expect(understand('bill MYPH/26-27/0007 not printing')).toEqual({ kind: 'invoice', number: 'MYPH/26-27/0007' });
  });
  it('finds money questions', () => {
    expect(understand('How much does Nila Textiles owe?')).toEqual({ kind: 'dues', who: 'nila textiles' });
    expect(understand('outstanding of menon associates')).toEqual({ kind: 'dues', who: 'menon associates' });
    expect(understand('which bills are overdue')).toEqual({ kind: 'overdue' });
    expect(understand("today's sales")).toEqual({ kind: 'sales_today' });
    expect(understand('what is low on stock')).toEqual({ kind: 'low_stock' });
  });
  it('matches how-to answers and asks for a person', () => {
    expect(understand('How do I record a payment?')).toEqual({ kind: 'howto', id: 'payment' });
    expect(understand('transfer code not received')).toEqual({ kind: 'howto', id: 'receipt_code' });
    expect(understand('how to file gstr-1')).toEqual({ kind: 'howto', id: 'gst_return' });
    expect(understand('thermal printer printing on A4')).toEqual({ kind: 'howto', id: 'printer' });
    expect(understand('how do I transfer stock to branch')).toEqual({ kind: 'howto', id: 'transfer' });
    expect(understand('I want to talk to a person')).toEqual({ kind: 'human' });
    expect(understand('not solved, call me')).toEqual({ kind: 'human' });
    expect(understand('hello')).toEqual({ kind: 'greeting' });
    expect(understand('asdf qwer')).toEqual({ kind: 'unknown' });
    expect(bestHowTo('xyz')).toBeNull();
  });
});
