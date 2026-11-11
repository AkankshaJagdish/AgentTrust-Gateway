export function isAgentExpired(expiresAt:Date|null|undefined,now:Date=new Date()):boolean {
 return expiresAt!==null&&expiresAt!==undefined&&expiresAt.getTime()<=now.getTime();
}
