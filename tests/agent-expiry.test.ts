import {describe,expect,it} from "vitest";
import {isAgentExpired} from "@/lib/agent-expiry";
describe("agent identity expiry",()=>{
 const now=new Date("2026-11-11T12:00:00.000Z");
 it("does not expire agents with no expiry",()=>expect(isAgentExpired(null,now)).toBe(false));
 it("allows an agent whose expiry is in the future",()=>expect(isAgentExpired(new Date("2026-11-11T12:00:00.001Z"),now)).toBe(false));
 it("blocks an agent exactly at its expiry instant",()=>expect(isAgentExpired(now,now)).toBe(true));
 it("blocks an agent whose expiry is in the past",()=>expect(isAgentExpired(new Date("2026-11-11T11:59:59.999Z"),now)).toBe(true));
});
