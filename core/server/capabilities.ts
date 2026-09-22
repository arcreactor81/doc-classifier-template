
import type { ProjectPack } from '../config/project.ts';
import { ServerFailure } from './errors.ts';

export type Pricing=ProjectPack['prices'];
export function pricingFor(pack:ProjectPack,mode:'interactive'|'batch'):Pricing['interactive']{
 const value=(pack as ProjectPack&{prices?:Pricing}).prices;
 if(!value?.verifiedAt||!value.source||!value[mode])throw new ServerFailure('E_PRICING_UNVERIFIED','blocker','Verified published prices are not configured for this mode.');
 return value[mode];
}
export { EXECUTION_ATTEMPTS } from '../cost/policy.ts';