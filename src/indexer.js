const axios = require('axios')
const fetch = require('cross-fetch')
const { ethers } = require('ethers')
const { ApolloClient, InMemoryCache, gql, HttpLink } = require('@apollo/client')
const { GET_BOUNTY_DEPOSITS_DATA, UPDATE_BOUNTY } = require('./query/query')
const tokenMetadata = require('./local.json')

const subGraphClient = new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
        fetch,
        uri: 'http://localhost:8000/subgraphs/name/openqdev/openq',
    }),
})

const tvlClient = new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
        fetch,
        uri: 'http://localhost:8080/',
    }),
})

const fetchBounties = async () => {
    async function getTokenValues(tokenBalances) {
        const tokenVolumes = {}
        tokenBalances.forEach((tokenBalance) => {
            const tokenAddress =
                tokenMetadata[
                    ethers.utils.getAddress(tokenBalance.tokenAddress)
                ].address
            tokenVolumes[tokenAddress] = tokenBalance.volume
        })

        const params = { tokenVolumes, network: 'polygon-pos' }
        const url = 'http://localhost:8081/tvl'
        // only query tvl for bounties that have deposits
        if (JSON.stringify(params.tokenVolumes) !== '{}') {
            try {
                const { data } = await axios.post(url, params)
                return data
            } catch (error) {
                // continue regardless
            }
            return []
        }
        return []
    }
    const depositResponse = await subGraphClient.query({
        query: gql(GET_BOUNTY_DEPOSITS_DATA),
    })
    const { deposits } = depositResponse.data

    const tokenValues = await getTokenValues(deposits)
    const TVLS = deposits.map((tokenBalance) => {
        const tokenAddress = ethers.utils.getAddress(tokenBalance.tokenAddress)
        const tokenValueAddress = tokenMetadata[tokenAddress].address
        const { volume } = tokenBalance

        const bigNumberVolume = ethers.BigNumber.from(volume.toString())
        const decimals = parseInt(tokenMetadata[tokenAddress].decimals, 10)

        const formattedVolume = ethers.utils.formatUnits(
            bigNumberVolume,
            decimals
        )

        const totalValue =
            formattedVolume *
            tokenValues.tokenPrices[tokenValueAddress.toLowerCase()]

        return { bountyId: tokenBalance.bounty.bountyId, totalValue }
    })
    return TVLS
}
const updateTvls = async (values) => {
    const pending = []
    for (let i = 0; i < values.length; i += 1) {
        const value = values[i]
        const { bountyId } = value
        const tvl = parseFloat(value.totalValue)
        const result = tvlClient.mutate({
            mutation: gql(UPDATE_BOUNTY),
            variables: { bountyId, tvl },
        })
        pending.push(result)
    }
    await Promise.all(pending)
}
const indexer = async () => {
    const TVLS = await fetchBounties()
    await updateTvls(TVLS)
}

indexer()
