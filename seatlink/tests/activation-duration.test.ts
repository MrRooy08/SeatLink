import { expect, it } from 'vitest'
import { isActivationDuration, maxActivationMinutes, maxActivationSeconds, parseActivationMinutes } from '../src/features/seats/activation-duration'

it.each([1,5,10,12,15,20,25,35791394])('accepts %i positive whole minutes without rounding',minutes=>{
 expect(parseActivationMinutes(String(minutes))).toEqual({seconds:minutes*60,error:''})
 expect(isActivationDuration(minutes*60)).toBe(true)
})
it.each(['','0','-1','1.5','12abc','abc','1e3','1E3','Infinity','NaN','+12',' 12','12 '])('rejects invalid input %j completely',value=>{
 expect(parseActivationMinutes(value)).toEqual({seconds:null,error:'Enter a whole number greater than 0.'})
})
it('uses the exact whole-minute limit fitting PostgreSQL int4 seconds',()=>{
 expect(maxActivationMinutes).toBe(35791394)
 expect(maxActivationSeconds).toBe(2147483640)
 expect(maxActivationSeconds).toBeLessThanOrEqual(2147483647)
 expect(maxActivationSeconds+60).toBeGreaterThan(2147483647)
 for(const value of ['35791395','999999999999999999999999999999999999999999999999999999999999999999999999999999']) {
  expect(parseActivationMinutes(value)).toEqual({seconds:null,error:'Enter 35791394 minutes or less.'})
 }
 for(const seconds of [0,-60,61,60.5,Infinity,NaN,2147483700]) expect(isActivationDuration(seconds)).toBe(false)
})
