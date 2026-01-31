'use client'

import { useState, useEffect, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Market {
  ticker: string
  title: string
  yes_sub_title?: string
  last_price?: number
  volume?: number
}

interface Event {
  ticker: string
  title: string
  category: string
  type?: string
  markets: Market[]
}

interface Position {
  ticker: string
  position: number
  market_title?: string
  yes_sub_title?: string
  market_exposure?: number
  realized_pnl?: number
  total_traded?: number
  resting_orders_count?: number
}

interface Order {
  order_id: string
  ticker: string
  side: string
  action: string
  type: string
  status: string
  yes_price?: number
  no_price?: number
  remaining_count: number
  created_time: string
}

type OrderbookLevel = [number, number]

interface Orderbook {
  yes: OrderbookLevel[]
  no: OrderbookLevel[]
}

interface HistoryPoint {
  ts: number
  yes_price: number
  yes_bid: number
  yes_ask: number
  volume: number
  open_interest: number
}

interface Trade {
  trade_id: string
  ticker: string
  yes_price: number
  count: number
  taker_side: string
  created_time: string
}

export default function TradingDashboard() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [orderbooks, setOrderbooks] = useState<Record<string, Orderbook>>({})
  const [balance, setBalance] = useState<number | null>(null)
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [orderInputs, setOrderInputs] = useState<Record<string, { price: string; qty: string }>>({})
  const [orders, setOrders] = useState<Order[]>([])
  const [showPositions, setShowPositions] = useState(true)
  const [maxBetMode, setMaxBetMode] = useState<'yes' | 'no' | 'off'>('off')
  const [selectedStrike, setSelectedStrike] = useState<Market | null>(null)
  const [strikeHistory, setStrikeHistory] = useState<HistoryPoint[]>([])
  const [strikeTrades, setStrikeTrades] = useState<Trade[]>([])
  const [historyPeriod, setHistoryPeriod] = useState<number>(60) // minutes
  const [strikeOrderbook, setStrikeOrderbook] = useState<Orderbook | null>(null)
  const [pennyBotStrikes, setPennyBotStrikes] = useState<Record<string, 'yes' | 'no' | 'both' | 'off'>>({})
  const [pennyBotLog, setPennyBotLog] = useState<string[]>([])
  const [pennyBotLastPrice, setPennyBotLastPrice] = useState<Record<string, number>>({})

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const res = await fetch(`${API}/api/balance`)
      const data = await res.json()
      if (!data.error) {
        setBalance(data.balance)
        setPortfolioValue(data.portfolio_value)
      }
    } catch (e) {}
  }

  // Fetch positions
  const fetchPositions = async () => {
    try {
      const res = await fetch(`${API}/api/positions`)
      const data = await res.json()
      setPositions(data.market_positions || [])
    } catch (e) {}
  }

  // Fetch resting orders
  const fetchOrders = async () => {
    try {
      const res = await fetch(`${API}/api/orders?status=resting`)
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (e) {}
  }

  // Cancel order
  const cancelOrder = async (orderId: string) => {
    try {
      await fetch(`${API}/api/orders/${orderId}`, { method: 'DELETE' })
      fetchOrders()
      fetchBalance()
    } catch (e) {}
  }

  // Max bet - buy all available at weighted average price
  const maxBet = async (ticker: string, side: 'yes' | 'no') => {
    const ob = orderbooks[ticker]
    if (!ob) return

    // For buying YES, we take from NO bids (100 - no_price = yes_ask)
    // For buying NO, we take from YES bids (100 - yes_price = no_ask)
    const levels = side === 'yes' ? ob.no : ob.yes
    if (!levels || levels.length === 0) {
      alert('No liquidity available')
      return
    }

    // Calculate total qty and weighted average price
    const totalQty = levels.reduce((sum, [_, qty]) => sum + qty, 0)

    try {
      const body = {
        ticker,
        side,
        action: 'buy',
        count: totalQty,
        type: 'market',
      }

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        alert('Max bet placed!')
        fetchBalance()
        fetchPositions()
        fetchOrderbook(ticker)
      } else {
        alert('Error: ' + JSON.stringify(data))
      }
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  // Fetch strike detail data
  const openStrikeDetail = async (market: Market) => {
    setSelectedStrike(market)
    fetchStrikeData(market.ticker, historyPeriod)
  }

  const fetchStrikeData = async (ticker: string, period: number) => {
    // Fetch full orderbook
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/orderbook?depth=50`)
      const data = await res.json()
      setStrikeOrderbook(data.orderbook)
    } catch (e) {}

    // Fetch history
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/history?period_interval=${period}`)
      const data = await res.json()
      setStrikeHistory(data.history || [])
    } catch (e) {
      setStrikeHistory([])
    }

    // Fetch recent trades
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/trades?limit=50`)
      const data = await res.json()
      setStrikeTrades(data.trades || [])
    } catch (e) {
      setStrikeTrades([])
    }
  }

  // Change history period
  const changeHistoryPeriod = (period: number) => {
    setHistoryPeriod(period)
    if (selectedStrike) {
      fetchStrikeData(selectedStrike.ticker, period)
    }
  }

  // Fetch Mentions
  const fetchEvents = async (search?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('category', 'Mentions')
      params.append('limit', '50')
      if (search) params.append('search', search)

      const res = await fetch(`${API}/api/events?${params}`)
      const data = await res.json()
      setEvents(data.events || [])
    } catch (e) {
      console.error('Failed to fetch events:', e)
    }
    setLoading(false)
  }

  // Fetch orderbook
  const fetchOrderbook = async (ticker: string) => {
    try {
      const res = await fetch(`${API}/api/markets/${ticker}/orderbook`)
      const data = await res.json()
      setOrderbooks(prev => ({ ...prev, [ticker]: data.orderbook }))
    } catch (e) {}
  }

  // Fetch all orderbooks for selected event
  const fetchEventOrderbooks = async (event: Event) => {
    for (const market of event.markets) {
      fetchOrderbook(market.ticker)
    }
  }

  // Place order
  const placeOrder = async (ticker: string, side: 'yes' | 'no', action: 'buy' | 'sell') => {
    const input = orderInputs[ticker]
    if (!input?.qty) {
      alert('Enter quantity')
      return
    }

    try {
      const body: any = {
        ticker,
        side,
        action,
        count: parseInt(input.qty),
        type: input.price ? 'limit' : 'market',
      }
      if (input.price) {
        if (side === 'yes') body.yes_price = parseInt(input.price)
        else body.no_price = parseInt(input.price)
      }

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        alert('Order placed!')
        fetchBalance()
        fetchPositions()
        fetchOrderbook(ticker)
      } else {
        alert('Error: ' + JSON.stringify(data))
      }
    } catch (e: any) {
      alert('Error: ' + e.message)
    }
  }

  // Initial load
  useEffect(() => {
    fetchBalance()
    fetchPositions()
    fetchEvents()

    const interval = setInterval(() => {
      fetchBalance()
      fetchPositions()
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvents(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // When event selected, fetch orderbooks and orders
  useEffect(() => {
    if (selectedEvent) {
      fetchEventOrderbooks(selectedEvent)
      fetchOrders()
      // Refresh orderbooks and orders periodically
      const interval = setInterval(() => {
        fetchEventOrderbooks(selectedEvent)
        fetchOrders()
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [selectedEvent])

  // Penny bot logic
  const placePennyOrder = async (ticker: string, side: 'yes' | 'no', price: number) => {
    try {
      const body: any = {
        ticker,
        side,
        action: 'buy',
        count: 10,
        type: 'limit',
      }
      if (side === 'yes') body.yes_price = price
      else body.no_price = price

      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.order) {
        const logMsg = `[${new Date().toLocaleTimeString()}] Placed ${side.toUpperCase()} bid: ${price}¢ x10 on ${ticker}`
        setPennyBotLog(prev => [logMsg, ...prev].slice(0, 50))
        fetchOrders()
        fetchBalance()
      }
    } catch (e) {
      console.error('Penny bot order failed:', e)
    }
  }

  // Penny bot effect - checks orderbooks and places orders
  // Track pending orders to prevent duplicates
  const pennyBotPending = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedEvent) return

    // Check if any strikes have penny bot enabled
    const activeStrikes = Object.entries(pennyBotStrikes).filter(([_, mode]) => mode !== 'off')
    if (activeStrikes.length === 0) return

    const checkAndPlace = async () => {
      for (const market of selectedEvent.markets) {
        const botMode = pennyBotStrikes[market.ticker]
        if (!botMode || botMode === 'off') continue

        const ob = orderbooks[market.ticker]
        if (!ob) continue

        const sides: ('yes' | 'no')[] = botMode === 'both' ? ['yes', 'no'] : [botMode]

        for (const side of sides) {
          const key = `${market.ticker}-${side}`

          // Skip if we're already processing this strike/side
          if (pennyBotPending.current.has(key)) continue

          // Check if we already have ANY resting order on this strike/side - max 1 order per strike/side
          const existingOrder = orders.find(
            o => o.ticker === market.ticker && o.side === side
          )
          if (existingOrder) continue

          // Get bids for this side
          const bids = side === 'yes' ? ob.yes : ob.no
          if (!bids || bids.length === 0) continue

          // Find highest bid and its quantity
          const highestBid = Math.max(...bids.map(([p]) => p))
          const highestBidQty = bids.filter(([p]) => p === highestBid).reduce((sum, [_, q]) => sum + q, 0)

          // Check conditions: bid < 90, qty at highest bid > 69
          if (highestBid >= 90 || highestBidQty <= 69) continue

          // Check if we already hold > 50 contracts on this side
          const position = positions.find(p => p.ticker === market.ticker)
          const heldQty = position?.position || 0
          // position > 0 means YES, position < 0 means NO
          if (side === 'yes' && heldQty > 50) continue
          if (side === 'no' && heldQty < -50) continue

          // Target price is 1 cent above highest bid
          const targetPrice = highestBid + 1

          // Check if we already placed at this exact price (got filled) - skip until price changes
          const lastPriceKey = `${market.ticker}-${side}`
          if (pennyBotLastPrice[lastPriceKey] === targetPrice) continue

          // Check there's no ask that would immediately fill us (spread exists)
          const oppositeAsks = side === 'yes' ? ob.no : ob.yes
          if (oppositeAsks && oppositeAsks.length > 0) {
            const lowestAsk = 100 - Math.max(...oppositeAsks.map(([p]) => p))
            if (targetPrice >= lowestAsk) continue // Would cross the spread
          }

          // Mark as pending and place the order
          pennyBotPending.current.add(key)
          try {
            await placePennyOrder(market.ticker, side, targetPrice)
            // Track the price we placed at
            setPennyBotLastPrice(prev => ({ ...prev, [lastPriceKey]: targetPrice }))
          } finally {
            // Remove from pending after a delay to allow order to appear in orders list
            setTimeout(() => pennyBotPending.current.delete(key), 2000)
          }
        }
      }
    }

    checkAndPlace()
  }, [pennyBotStrikes, orderbooks, orders, selectedEvent, positions])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Kalshi</h1>
              <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                Mentions
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-gray-600">
                <span className="font-medium text-gray-900">
                  ${balance !== null ? (balance / 100).toFixed(0) : '---'}
                </span>
                {' '}Cash
              </div>
              <div className="text-gray-600">
                <span className="font-medium text-gray-900">
                  ${portfolioValue !== null ? (portfolioValue / 100).toFixed(0) : '---'}
                </span>
                {' '}Portfolio
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      {selectedEvent ? (
        // Event detail view
        <div className="max-w-5xl mx-auto px-4 py-6">
          <button
            onClick={() => setSelectedEvent(null)}
            className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            ← Back to markets
          </button>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedEvent.title}</h2>

          {/* Max Bet Bar */}
          <div className="bg-gray-100 rounded-lg p-3 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Quick Max Bet</span>
              <div className="flex items-center gap-1 bg-white rounded-lg p-1 border">
                <button
                  onClick={() => setMaxBetMode('yes')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'yes' ? 'bg-green-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Buy Yes
                </button>
                <button
                  onClick={() => setMaxBetMode('no')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'no' ? 'bg-red-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Buy No
                </button>
                <button
                  onClick={() => setMaxBetMode('off')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${maxBetMode === 'off' ? 'bg-gray-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  Off
                </button>
              </div>
            </div>

            {maxBetMode !== 'off' && (
              <div className="grid grid-cols-5 gap-2">
                {selectedEvent.markets.map((market) => {
                  const ob = orderbooks[market.ticker]
                  const levels = maxBetMode === 'yes' ? ob?.no : ob?.yes
                  const totalQty = levels?.reduce((sum, [_, qty]) => sum + qty, 0) || 0

                  // Calculate weighted average price
                  let weightedAvgPrice = null
                  if (levels && levels.length > 0 && totalQty > 0) {
                    const totalCost = levels.reduce((sum, [price, qty]) => {
                      const askPrice = 100 - price // Convert bid to ask price
                      return sum + (askPrice * qty)
                    }, 0)
                    weightedAvgPrice = Math.round(totalCost / totalQty)
                  }

                  return (
                    <button
                      key={market.ticker}
                      onClick={() => maxBet(market.ticker, maxBetMode)}
                      disabled={totalQty === 0}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        totalQty === 0
                          ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                          : maxBetMode === 'yes'
                            ? 'bg-green-50 border-green-300 text-green-800 hover:bg-green-100'
                            : 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
                      }`}
                    >
                      <div className="font-semibold truncate">{market.yes_sub_title || market.ticker}</div>
                      <div className="text-[10px] opacity-75">
                        {weightedAvgPrice !== null ? `${totalQty} @ ${weightedAvgPrice}¢` : '--'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {maxBetMode === 'off' && (
              <p className="text-xs text-gray-500">Select "Buy Yes" or "Buy No" to enable quick max bets on all strikes</p>
            )}
          </div>

          {/* Penny Bot Controls */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-yellow-800">🤖 Penny Bot</span>
                <span className="text-xs text-yellow-600">(bid &lt;90¢, qty &gt;69)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">All strikes:</span>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'yes' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium"
                >
                  All Yes
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'no' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium"
                >
                  All No
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'both' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium"
                >
                  All Both
                </button>
                <button
                  onClick={() => {
                    const newSettings: Record<string, 'yes' | 'no' | 'both' | 'off'> = {}
                    selectedEvent.markets.forEach(m => { newSettings[m.ticker] = 'off' })
                    setPennyBotStrikes(prev => ({ ...prev, ...newSettings }))
                  }}
                  className="px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs font-medium"
                >
                  All Off
                </button>
                <div className="w-px h-4 bg-yellow-300 mx-1"></div>
                <button
                  onClick={async () => {
                    if (!confirm(`Cancel all ${orders.length} resting orders?`)) return
                    for (const order of orders) {
                      await cancelOrder(order.order_id)
                    }
                  }}
                  className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-medium"
                >
                  Cancel All ({orders.length})
                </button>
              </div>
            </div>
          </div>

          {/* Penny Bot Log */}
          {pennyBotLog.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-yellow-800">🤖 Penny Bot Log</span>
                <button
                  onClick={() => setPennyBotLog([])}
                  className="text-xs text-yellow-600 hover:text-yellow-800"
                >
                  Clear
                </button>
              </div>
              <div className="bg-white rounded border border-yellow-200 p-2 max-h-24 overflow-y-auto">
                {pennyBotLog.map((log, i) => (
                  <div key={i} className="text-xs text-gray-600 font-mono">{log}</div>
                ))}
              </div>
            </div>
          )}

          <p className="text-gray-500 mb-4">{selectedEvent.markets.length} strikes available</p>

          {/* Strikes grid - 2 columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedEvent.markets.map((market) => {
              const ob = orderbooks[market.ticker]
              const yesBid = ob?.yes?.[0]?.[0]
              const yesAsk = ob?.no?.[0] ? 100 - ob.no[0][0] : undefined
              const noBid = ob?.no?.[0]?.[0]
              const noAsk = ob?.yes?.[0] ? 100 - ob.yes[0][0] : undefined
              const input = orderInputs[market.ticker] || { price: '', qty: '' }

              // Get position for this market
              const position = positions.find(p => p.ticker === market.ticker)

              // Get resting orders for this market
              const marketOrders = orders.filter(o => o.ticker === market.ticker)

              // Calculate running totals for orderbook display - no limit, show all
              const yesLevels = ob?.yes || []
              const noLevels = ob?.no || []

              // YES Bids with running totals
              let yesTotal = 0
              const yesBids = yesLevels.map(([price, qty]) => {
                yesTotal += qty
                return { price, qty, total: yesTotal }
              })

              // NO Bids with running totals
              let noTotal = 0
              const noBids = noLevels.map(([price, qty]) => {
                noTotal += qty
                return { price, qty, total: noTotal }
              })

              // YES Asks (from NO bids) with running totals
              let yesAskTotal = 0
              const yesAsks = noLevels.map(([noPrice, qty]) => {
                yesAskTotal += qty
                return { price: 100 - noPrice, qty, total: yesAskTotal }
              })

              // NO Asks (from YES bids) with running totals
              let noAskTotal = 0
              const noAsks = yesLevels.map(([yesPrice, qty]) => {
                noAskTotal += qty
                return { price: 100 - yesPrice, qty, total: noAskTotal }
              })

              return (
                <div key={market.ticker} className="bg-white rounded-lg border shadow-sm">
                  {/* Strike header with Yes/No buttons */}
                  <div className="p-4 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openStrikeDetail(market)}>
                        <h3 className="font-semibold text-gray-900 truncate hover:text-blue-600">
                          {market.yes_sub_title || market.title}
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">{market.ticker} <span className="text-blue-500">· View details</span></p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => placeOrder(market.ticker, 'yes', 'buy')}
                          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm min-w-[80px]"
                        >
                          Yes {yesBid !== undefined ? `${yesBid}¢` : '--'}
                        </button>
                        <button
                          onClick={() => placeOrder(market.ticker, 'no', 'buy')}
                          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium text-sm min-w-[80px]"
                        >
                          No {noBid !== undefined ? `${noBid}¢` : '--'}
                        </button>
                      </div>
                    </div>

                    {/* Penny Bot per-strike toggle */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">🤖 Penny</span>
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded p-0.5">
                          {(['off', 'yes', 'no', 'both'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setPennyBotStrikes(prev => ({ ...prev, [market.ticker]: mode }))}
                              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                (pennyBotStrikes[market.ticker] || 'off') === mode
                                  ? mode === 'off' ? 'bg-gray-500 text-white'
                                    : mode === 'yes' ? 'bg-green-500 text-white'
                                    : mode === 'no' ? 'bg-red-500 text-white'
                                    : 'bg-blue-500 text-white'
                                  : 'text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {mode === 'off' ? 'Off' : mode === 'yes' ? 'Y' : mode === 'no' ? 'N' : 'Both'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {pennyBotStrikes[market.ticker] && pennyBotStrikes[market.ticker] !== 'off' && (
                        <span className="text-xs text-yellow-600 font-medium">Active</span>
                      )}
                    </div>

                    {/* Position display with close button */}
                    {position && position.position !== 0 && (
                      <div className={`mt-2 px-3 py-1.5 rounded-md text-sm ${position.position > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        <div className="flex items-center justify-between">
                          <span>
                            Position: <span className="font-semibold">{position.position > 0 ? 'Yes' : 'No'} {Math.abs(position.position)}</span>
                            {position.market_exposure !== undefined && (
                              <span className="text-xs opacity-75 ml-2">
                                @ {Math.round(Math.abs(position.market_exposure) / Math.abs(position.position))}¢
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => {
                              const side = position.position > 0 ? 'yes' : 'no'
                              const qty = Math.abs(position.position)
                              setOrderInputs(prev => ({
                                ...prev,
                                [market.ticker]: { price: '', qty: String(qty) }
                              }))
                            }}
                            className="px-2 py-0.5 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs font-medium"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Resting orders display */}
                    {marketOrders.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {marketOrders.map(order => (
                          <div key={order.order_id} className={`flex items-center justify-between px-3 py-1.5 rounded-md text-xs ${order.side === 'yes' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            <span>
                              <span className="font-semibold">{order.side === 'yes' ? 'YES' : 'NO'}</span>
                              {' '}<span className="font-medium">{order.remaining_count}</span> @ <span className="font-medium">{order.side === 'yes' ? order.yes_price : order.no_price}¢</span>
                              <span className="text-gray-500 ml-1">({order.action})</span>
                            </span>
                            <button
                              onClick={() => cancelOrder(order.order_id)}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Side-by-side orderbooks - Kalshi style with Bid/Ask */}
                  <div className="grid grid-cols-2 divide-x">
                    {/* YES Orderbook */}
                    <div className="p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                        Yes
                      </div>
                      <div className="text-xs">
                        <div className="flex text-gray-500 border-b pb-1 mb-1">
                          <span className="flex-1">Price</span>
                          <span className="w-12 text-right">Qty</span>
                          <span className="w-12 text-right">Total</span>
                        </div>
                        {/* YES Asks - scrollable, highest at top, starts scrolled to bottom */}
                        <div className="max-h-24 overflow-y-auto flex flex-col-reverse">
                          {yesAsks.length > 0 ? [...yesAsks].reverse().map((level, i, arr) => {
                            const totalFromHere = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`ask-${i}`}
                                className="flex bg-red-50 cursor-pointer hover:bg-red-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromHere) }
                                }))}
                              >
                                <span className="flex-1 text-red-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-red-600">{level.qty}</span>
                                <span className="w-12 text-right text-red-400">{totalFromHere}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-red-300 py-1 text-center">--</div>
                          )}
                        </div>
                        {/* Spread */}
                        <div className="border-y bg-gray-100 text-center py-1 text-[10px] text-gray-500 font-medium my-1">
                          {yesBid !== undefined && yesAsk !== undefined
                            ? `Spread: ${yesAsk - yesBid}¢`
                            : 'Spread: --'}
                        </div>
                        {/* YES Bids - scrollable, highest at top, total from spread */}
                        <div className="max-h-24 overflow-y-auto">
                          {yesBids.length > 0 ? [...yesBids].reverse().map((level, i, arr) => {
                            const totalFromSpread = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`bid-${i}`}
                                className="flex bg-green-50 cursor-pointer hover:bg-green-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromSpread) }
                                }))}
                              >
                                <span className="flex-1 text-green-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-green-600">{level.qty}</span>
                                <span className="w-12 text-right text-green-400">{totalFromSpread}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-green-300 py-1 text-center">--</div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NO Orderbook */}
                    <div className="p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                        No
                      </div>
                      <div className="text-xs">
                        <div className="flex text-gray-500 border-b pb-1 mb-1">
                          <span className="flex-1">Price</span>
                          <span className="w-12 text-right">Qty</span>
                          <span className="w-12 text-right">Total</span>
                        </div>
                        {/* NO Asks - scrollable, highest at top, starts scrolled to bottom */}
                        <div className="max-h-24 overflow-y-auto flex flex-col-reverse">
                          {noAsks.length > 0 ? [...noAsks].reverse().map((level, i, arr) => {
                            const totalFromHere = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`ask-${i}`}
                                className="flex bg-red-50 cursor-pointer hover:bg-red-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromHere) }
                                }))}
                              >
                                <span className="flex-1 text-red-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-red-600">{level.qty}</span>
                                <span className="w-12 text-right text-red-400">{totalFromHere}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-red-300 py-1 text-center">--</div>
                          )}
                        </div>
                        {/* Spread */}
                        <div className="border-y bg-gray-100 text-center py-1 text-[10px] text-gray-500 font-medium my-1">
                          {noBid !== undefined && noAsk !== undefined
                            ? `Spread: ${noAsk - noBid}¢`
                            : 'Spread: --'}
                        </div>
                        {/* NO Bids - scrollable, highest at top, total from spread */}
                        <div className="max-h-24 overflow-y-auto">
                          {noBids.length > 0 ? [...noBids].reverse().map((level, i, arr) => {
                            const totalFromSpread = arr.slice(0, i + 1).reduce((sum, l) => sum + l.qty, 0)
                            return (
                              <div
                                key={`bid-${i}`}
                                className="flex bg-green-50 cursor-pointer hover:bg-green-100 py-0.5"
                                onClick={() => setOrderInputs(prev => ({
                                  ...prev,
                                  [market.ticker]: { price: String(level.price), qty: String(totalFromSpread) }
                                }))}
                              >
                                <span className="flex-1 text-green-600 font-medium">{level.price}¢</span>
                                <span className="w-12 text-right text-green-600">{level.qty}</span>
                                <span className="w-12 text-right text-green-400">{totalFromSpread}</span>
                              </div>
                            )
                          }) : (
                            <div className="text-green-300 py-1 text-center">--</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Order entry - Yes buttons | Inputs | No buttons */}
                  <div className="flex items-center justify-between p-3 border-t bg-gray-50">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => placeOrder(market.ticker, 'yes', 'buy')}
                        className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                      >
                        Buy Yes
                      </button>
                      <button
                        onClick={() => placeOrder(market.ticker, 'yes', 'sell')}
                        className="px-3 py-1.5 bg-green-100 text-green-700 border border-green-300 rounded text-xs font-medium hover:bg-green-200"
                      >
                        Sell Yes
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="Price ¢"
                        value={input.price}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [market.ticker]: { ...prev[market.ticker], price: e.target.value }
                        }))}
                        className="w-20 border rounded px-2 py-1.5 text-sm text-center"
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        value={input.qty}
                        onChange={(e) => setOrderInputs(prev => ({
                          ...prev,
                          [market.ticker]: { ...prev[market.ticker], qty: e.target.value }
                        }))}
                        className="w-16 border rounded px-2 py-1.5 text-sm text-center"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => placeOrder(market.ticker, 'no', 'buy')}
                        className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
                      >
                        Buy No
                      </button>
                      <button
                        onClick={() => placeOrder(market.ticker, 'no', 'sell')}
                        className="px-3 py-1.5 bg-red-100 text-red-700 border border-red-300 rounded text-xs font-medium hover:bg-red-200"
                      >
                        Sell No
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        // Market list view
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md bg-white border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((event) => (
                <div
                  key={event.ticker}
                  onClick={() => setSelectedEvent(event)}
                  className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all"
                >
                  <h3 className="font-medium text-gray-900 mb-3 line-clamp-2">{event.title}</h3>

                  {/* Preview strikes */}
                  <div className="space-y-1.5">
                    {event.markets.slice(0, 4).map((market) => (
                      <div key={market.ticker} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 truncate mr-2">
                          {market.yes_sub_title || market.title}
                        </span>
                        <span className="font-medium">
                          {market.last_price ? `${market.last_price}%` : '--'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {event.markets.length > 4 && (
                    <div className="text-xs text-blue-600 mt-2">
                      +{event.markets.length - 4} more strikes
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {events.length === 0 && !loading && (
            <div className="text-center text-gray-500 py-10">
              No markets found
            </div>
          )}
        </div>
      )}

      {/* Positions Panel - Collapsible */}
      {positions.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50">
          {showPositions ? (
            <div className="bg-white rounded-lg shadow-lg border w-72">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-100 rounded-t-lg">
                <h3 className="font-medium text-sm">Positions ({positions.length})</h3>
                <button
                  onClick={() => setShowPositions(false)}
                  className="w-6 h-6 flex items-center justify-center bg-gray-300 hover:bg-gray-400 text-gray-700 rounded text-sm font-bold"
                >
                  −
                </button>
              </div>
              <div className="p-3 space-y-2 overflow-y-auto max-h-48">
                {positions.map((pos) => (
                  <div key={pos.ticker} className="text-xs">
                    <div className="truncate text-gray-700">
                      {pos.yes_sub_title || pos.market_title || pos.ticker}
                    </div>
                    <span className={pos.position > 0 ? 'text-green-600' : 'text-red-600'}>
                      {pos.position > 0 ? 'Yes' : 'No'} {Math.abs(pos.position)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowPositions(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg px-4 py-2 text-sm font-medium"
            >
              Positions ({positions.length})
            </button>
          )}
        </div>
      )}

      {/* Strike Detail Modal */}
      {selectedStrike && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <div>
                <h2 className="text-lg font-bold">{selectedStrike.yes_sub_title || selectedStrike.title}</h2>
                <p className="text-xs text-gray-500">{selectedStrike.ticker}</p>
              </div>
              <button
                onClick={() => setSelectedStrike(null)}
                className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-full text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
              {/* Time Period Selector */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-gray-600">Period:</span>
                {[
                  { label: '1m', value: 1 },
                  { label: '5m', value: 5 },
                  { label: '15m', value: 15 },
                  { label: '1h', value: 60 },
                  { label: '1d', value: 1440 },
                ].map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => changeHistoryPeriod(value)}
                    className={`px-3 py-1 rounded text-sm ${historyPeriod === value ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Price History Chart (simple ASCII-style for now) */}
              <div className="bg-gray-100 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-sm mb-2">Price History</h3>
                {strikeHistory.length > 0 ? (
                  <div className="h-32 flex items-end gap-px">
                    {strikeHistory.slice(-50).map((point, i) => {
                      const height = point.yes_price || 50
                      return (
                        <div
                          key={i}
                          className="flex-1 bg-blue-500 rounded-t min-w-[2px]"
                          style={{ height: `${height}%` }}
                          title={`${new Date(point.ts * 1000).toLocaleString()}: ${point.yes_price}¢`}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No history data available</p>
                )}
                {strikeHistory.length > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{new Date(strikeHistory[0]?.ts * 1000).toLocaleTimeString()}</span>
                    <span>{new Date(strikeHistory[strikeHistory.length - 1]?.ts * 1000).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full Orderbook */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-3">Full Orderbook</h3>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    {/* YES Side */}
                    <div>
                      <div className="font-medium text-green-700 mb-1">YES Bids</div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {strikeOrderbook?.yes && [...strikeOrderbook.yes].reverse().map(([price, qty], i) => (
                          <div key={i} className="flex justify-between bg-green-50 px-2 py-0.5 rounded">
                            <span className="text-green-700">{price}¢</span>
                            <span>{qty}</span>
                          </div>
                        ))}
                        {(!strikeOrderbook?.yes || strikeOrderbook.yes.length === 0) && (
                          <div className="text-gray-400">No bids</div>
                        )}
                      </div>
                    </div>
                    {/* NO Side */}
                    <div>
                      <div className="font-medium text-red-700 mb-1">NO Bids</div>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {strikeOrderbook?.no && [...strikeOrderbook.no].reverse().map(([price, qty], i) => (
                          <div key={i} className="flex justify-between bg-red-50 px-2 py-0.5 rounded">
                            <span className="text-red-700">{price}¢</span>
                            <span>{qty}</span>
                          </div>
                        ))}
                        {(!strikeOrderbook?.no || strikeOrderbook.no.length === 0) && (
                          <div className="text-gray-400">No bids</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent Trades */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-3">Recent Trades</h3>
                  <div className="max-h-64 overflow-y-auto space-y-1 text-xs">
                    {strikeTrades.length > 0 ? strikeTrades.map((trade) => (
                      <div key={trade.trade_id} className="flex justify-between items-center bg-white px-2 py-1 rounded border">
                        <span className={trade.taker_side === 'yes' ? 'text-green-600' : 'text-red-600'}>
                          {trade.taker_side === 'yes' ? 'BUY' : 'SELL'} {trade.count}
                        </span>
                        <span className="font-medium">{trade.yes_price}¢</span>
                        <span className="text-gray-400">
                          {new Date(trade.created_time).toLocaleTimeString()}
                        </span>
                      </div>
                    )) : (
                      <div className="text-gray-400">No recent trades</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
