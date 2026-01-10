Все запросы содержат хедер
- Authorization: `tma ${initDataRaw}`

# Users

## POST /users/get_me
Request Body -
Response Body:
```json
{
    "user": {
        "id": "uuid",
        "telegramId": "unique int",
        "createdAt": "timestamp",
        "updatedAt": "timestamp"
    },
    "wallet": {
        "id": "uuid",
        "userId": "uuid",
        "balance": "integer",
        "lockedBalance": "integer",
        "createdAt": "timestamp",
        "updatedAt": "timestamp"
    }
}
```

# Auctions

## POST /auctions/get_list
Request Body 
```json
{
    "filters": {
        "status": ["enum: [active, ended, cancelled]"] | null, # default на беке ["active"]
        "sellerId": uuid | null,
        "itemId": "uuid" # пока не делаем
    },
    "pagination": {
        "page": "integer",
        "pageSize": "integer"
    }
}
```

Response Body:
```json
{
    "total": "integer",
    "pagination": {
        "page": "integer",
        "pageSize": "integer"
    },
    "auctions": [{
        "id": "uuid",
        "status": "enum: [active, ended, cancelled]",
        "sellerId": "uuid",
        "sellerWalletId": "uuid",
        "settings": {
            "antisniping": "boolean",
            "minBid": "integer",
            "minBidDifference": "integer"
        },
        "createdAt": "timestamp",
        "updatedAt": "timestamp"
    }]  
}
```

## POST /auctions/get/{auction_id}

Request Body -

Response Body:
```json
{
    "auction": {
        "id": "uuid",
        "status": "enum: [active, ended, cancelled]",
        "sellerId": "uuid",
        "sellerWalletId": "uuid",
        "settings": {
            "antisniping": "boolean",
            "minBid": "integer",
            "minBidDifference": "integer"
        },
        "rounds": [
            {
                "startTime": "timestamp",
                "endTime": "timestamp",
                "itemIds": ["uuid"]
                "items": [  # бек добавляет из другой таблички
                    {
                        "id": "${collectionName}_${num}",
                        "num": "integer",
                        "collectionName": "string",
                        "value": "string",
                        "ownerId": "uuid"
                    },
                ]
            }
        ],
        "createdAt": "timestamp",
        "updatedAt": "timestamp"
    }
}
```

# Bids
## POST /bids/get_my

Request Body -

Response Body: 
```json
{
    "bids": [
        {
            "id": "uuid",
            "userId": "uuid",
            "auctionId": "uuid",
            "amount": "integer",
            "status": "enum: [active, won, lost]"
        },
    ]
}
```

## POST /bids/get_by_auction/{auction_id}

Request Body -

Response Body: 
```json
{
    "my_bids": {
        "id": "uuid",
        "userId": "uuid",
        "auctionId": "uuid",
        "amount": "integer",
        "status": "enum: [active, won, lost]"
    },
    "top_bids": [
        {
            "id": "uuid",
            "userId": "uuid",
            "auctionId": "uuid",
            "amount": "integer",
            "status": "enum: [active, won, lost]"
        },
    ]
}
```
