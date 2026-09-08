import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NgramHashAddressing } from '../lib/engram/hash.js'

test('N-gram hash addressing is deterministic and returns slots', () => {
  const hasher = new NgramHashAddressing()
  const first = hasher.hash('铁门放外面久了为什么生锈')
  const second = hasher.hash('铁门放外面久了为什么生锈')
  assert.deepEqual(first, second)
  assert.ok(first.slots.length > 0)
})
