import { useEffect, useState } from 'react'

let clientId = ''

/** A document identity, separate from account/session identity across devices. */
export function getHouseholdClientId() {
	if (typeof window === 'undefined') return ''
	return (clientId ||= crypto.randomUUID())
}

export function HouseholdClientInput() {
	const [id, setId] = useState('')
	useEffect(() => setId(getHouseholdClientId()), [])
	return <input type="hidden" name="originClientId" value={id} />
}
