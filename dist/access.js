// Local prototype permissions. Production authorization must be enforced on a server.
export function isMaster(session){return session?.role==='master'}
export function canManageToken(session,token){return !!token&&(isMaster(session)||(session?.role==='player'&&token.kind==='hero'&&session.characterId===token.id))}
export function validSession(session,tokens){return isMaster(session)||(session?.role==='player'&&tokens.some(t=>t.id===session.characterId&&t.kind==='hero'))}
