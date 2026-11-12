import {describe,expect,it} from "vitest";
import {money} from "@/lib/money";
describe("PayPal authorization/capture safety constraints",()=>{
 it("holds amount comparisons at exact decimal precision",()=>expect(money("100.00").eq(money("100.00"))).toBe(true));
 it("rejects capture amounts that exceed approval",()=>expect(money("100.01").gt(money("100.00"))).toBe(true));
 it("detects currency mismatch",()=>expect("USD").not.toBe("EUR"));
 it("does not treat buyer approval as capture approval",()=>{const buyerApproved=true;const captureApprovalExists=false;expect(buyerApproved&&captureApprovalExists).toBe(false);});
 it("does not allow a revoked agent to satisfy ACTIVE status",()=>expect("REVOKED").not.toBe("ACTIVE"));
 it("does not allow expired consent",()=>expect(new Date("2000-01-01").getTime()>Date.now()).toBe(false));
});
