import { useEffect, useState } from 'react'

const FILES = ['monthly', 'weekly', 'daily', 'positioning', 'meta']

async function loadJson(name) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
  if (!response.ok) throw new Error(`Could not load data/${name}.json (${response.status})`)
  return response.json()
}

export function useData() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all(FILES.map(loadJson))
      .then(([monthly, weekly, daily, positioning, meta]) => {
        if (cancelled) return
        if (!monthly?.observations?.length || !daily?.observations?.length) {
          throw new Error('The data files contained no observations')
        }
        setState({
          status: 'ready',
          monthly: monthly.observations,
          weekly: weekly?.observations ?? [],
          daily: daily.observations,
          positioning: positioning ?? {},
          meta: meta ?? {},
          generatedAt: meta?.generated_at ?? null,
        })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', error: error.message })
      })
    return () => { cancelled = true }
  }, [])

  return state
}
