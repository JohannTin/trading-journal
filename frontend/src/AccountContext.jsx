import { createContext, useContext, useState, useEffect } from 'react'

const AccountContext = createContext(null)

export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([])
  // null = "All accounts"
  const [accountId, setAccountId] = useState(() => {
    const saved = localStorage.getItem('selected-account')
    return saved === 'null' || saved === null ? null : Number(saved)
  })

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(setAccounts)
      .catch(() => {})
  }, [])

  const select = (id) => {
    setAccountId(id)
    localStorage.setItem('selected-account', id === null ? 'null' : String(id))
  }

  const reload = () =>
    fetch('/api/accounts')
      .then(r => r.json())
      .then(setAccounts)
      .catch(() => {})

  return (
    <AccountContext.Provider value={{ accountId, accounts, select, reload }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  return useContext(AccountContext)
}
