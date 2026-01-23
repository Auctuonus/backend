# Модели данных Auctionus Backend

## Содержание

- [User](#user)
- [Wallet](#wallet)
- [Auction](#auction)
- [Bid](#bid)
- [Item](#item)
- [Transaction](#transaction)
- [Связи между моделями](#связи-между-моделями)

---

## User

Модель пользователя системы. Создаётся автоматически при первой авторизации через Telegram.

```typescript
{
  _id: ObjectId;
  telegramId: number;
  hashedPassword?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `telegramId` | `number` | Да | Уникальный ID пользователя в Telegram |
| `hashedPassword` | `string` | Нет | Хешированный пароль |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### Индексы

- `telegramId` (unique) - для быстрого поиска пользователя по Telegram ID

---

## Wallet

Модель кошелька пользователя. Хранит баланс и заблокированные средства.

```typescript
{
  _id: ObjectId;
  userId: ObjectId;
  balance: number;
  lockedBalance: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `userId` | `ObjectId` | Да | Ссылка на пользователя |
| `balance` | `number` | Да | Общий баланс в минимальных единицах валюты |
| `lockedBalance` | `number` | Да | Заблокированный баланс (активные ставки) |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### Индексы

- `userId` (unique) - один кошелёк на пользователя, частый поиск по userId

### Бизнес-логика

- **Свободный баланс** = `balance - lockedBalance`
- При размещении ставки средства блокируются: `lockedBalance += bidAmount`
- При проигрыше средства разблокируются: `lockedBalance -= bidAmount`
- При выигрыше средства списываются: `balance -= bidAmount`, `lockedBalance -= bidAmount`
- Все операции с балансом выполняются в MongoDB транзакциях

---

## Auction

Модель аукциона с поддержкой нескольких раундов и настройками.

```typescript
{
  _id: ObjectId;
  name: string;
  status: AuctionStatus;
  sellerId: ObjectId;
  sellerWalletId: ObjectId;
  settings: AuctionSettings;
  rounds: AuctionRound[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `name` | `string` | Да | Название аукциона |
| `status` | `AuctionStatus` | Да | Статус аукциона (по умолчанию: 'active') |
| `sellerId` | `ObjectId` | Да | Ссылка на продавца |
| `sellerWalletId` | `ObjectId` | Да | Ссылка на кошелёк продавца |
| `settings` | `AuctionSettings` | Да | Настройки аукциона |
| `rounds` | `AuctionRound[]` | Да | Массив раундов аукциона |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### AuctionStatus (Enum)

| Значение | Описание |
|----------|----------|
| `ACTIVE` | Аукцион активен |
| `ENDED` | Аукцион завершён |
| `CANCELLED` | Аукцион отменён |

### AuctionSettings (Вложенная схема)

```typescript
{
  antisniping?: number;
  minBid?: number;
  minBidDifference?: number;
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `antisniping` | `number` | Время продления раунда в секундах при ставке в конце |
| `minBid` | `number` | Минимальная ставка для участия в аукционе |
| `minBidDifference` | `number` | Минимальный шаг повышения ставки |

### AuctionRound (Вложенная схема)

```typescript
{
  startTime: Date;
  endTime: Date;
  status: AuctionStatus;
  processingStatus?: RoundProcessingStatus;
  itemIds: ObjectId[];
}
```

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `startTime` | `Date` | Да | Время начала раунда |
| `endTime` | `Date` | Да | Время окончания раунда |
| `status` | `AuctionStatus` | Да | Статус раунда (по умолчанию: 'active') |
| `processingStatus` | `RoundProcessingStatus` | Нет | Статус обработки завершённого раунда |
| `itemIds` | `ObjectId[]` | Да | Массив предметов в этом раунде |

### RoundProcessingStatus (Enum)

Используется для отслеживания этапов обработки завершённого раунда:

| Значение | Описание |
|----------|----------|
| `PENDING` | Раунд ещё не начался |
| `ACTIVE` | Раунд активен, принимаются ставки |
| `PROCESSING_WINNERS` | Определяем победителей |
| `PROCESSING_TRANSFERS` | Переводим средства |
| `PROCESSING_LOSERS` | Разблокируем средства проигравших |
| `COMPLETED` | Обработка завершена |
| `FAILED` | Ошибка обработки |

### AuctionProcessingStage (Enum)

Этапы обработки аукциона (используется в consumer):

| Значение | Описание |
|----------|----------|
| `DETERMINE_WINNERS` | Stage 1: Определение победителей |
| `TRANSFER_ITEMS` | Stage 2: Передача ownership предметов |
| `PROCESS_PAYMENTS` | Stage 3: Финансовые операции |
| `REFUND_LOSERS` | Stage 4: Разблокировка средств проигравших |
| `FINALIZE` | Stage 5: Финализация статусов |

### Индексы

- `status` - для фильтрации аукционов по статусу
- `sellerId + status` - для поиска аукционов продавца

### Бизнес-логика

- Один аукцион может иметь несколько раундов
- Каждый раунд содержит свои предметы
- Anti-sniping продлевает время раунда при ставке в конце
- Обработка раунда выполняется через RabbitMQ с отложенным сообщением

---

## Bid

Модель ставки пользователя на аукционе.

```typescript
{
  _id: ObjectId;
  userId: ObjectId;
  auctionId: ObjectId;
  amount: number;
  status: BidStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `userId` | `ObjectId` | Да | Ссылка на пользователя |
| `auctionId` | `ObjectId` | Да | Ссылка на аукцион |
| `amount` | `number` | Да | Сумма ставки в минимальных единицах валюты |
| `status` | `BidStatus` | Да | Статус ставки (по умолчанию: 'active') |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### BidStatus (Enum)

| Значение | Описание |
|----------|----------|
| `ACTIVE` | Ставка активна |
| `WON` | Ставка выиграла |
| `LOST` | Ставка проиграла |

### Индексы

- `auctionId + status + amount (desc)` - для поиска топ ставок по аукциону
- `auctionId + userId + status` - для поиска ставки пользователя на конкретном аукционе
- `userId` - для поиска всех ставок пользователя

### Бизнес-логика

- Пользователь может иметь только одну активную ставку на аукцион
- При повышении ставки разница блокируется на кошельке
- Победители определяются по наибольшей сумме ставки
- Количество победителей = количество предметов в раунде

---

## Item

Модель предмета (NFT, виртуальный товар), который выставляется на аукцион.

```typescript
{
  _id: ObjectId;
  num: number;
  collectionName: string;
  value: string;
  ownerId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `num` | `number` | Да | Номер предмета в коллекции |
| `collectionName` | `string` | Да | Название коллекции |
| `value` | `string` | Да | Значение/описание/метаданные предмета |
| `ownerId` | `ObjectId` | Да | Ссылка на текущего владельца |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### Индексы

- `collectionName + num` (unique) - уникальный составной индекс, один номер на коллекцию

### Бизнес-логика

- Каждый предмет принадлежит одной коллекции
- Номер предмета уникален в рамках коллекции
- При выигрыше аукциона `ownerId` меняется на победителя
- Предмет может участвовать только в одном активном аукционе

---

## Transaction

Модель транзакции для журнала всех финансовых операций в системе.

```typescript
{
  _id: ObjectId;
  fromWalletId: ObjectId;
  toWalletId: ObjectId | null;
  amount: number;
  type: TransactionType;
  relatedEntityId: ObjectId | null;
  relatedEntityType: RelatedEntityType | null;
  metadata: Record<string, any>;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Поля

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `fromWalletId` | `ObjectId` | Да | Кошелёк отправителя |
| `toWalletId` | `ObjectId` | Нет | Кошелёк получателя, null для блокировки средств |
| `amount` | `number` | Да | Сумма транзакции в минимальных единицах валюты |
| `type` | `TransactionType` | Да | Тип транзакции |
| `relatedEntityId` | `ObjectId` | Нет | ID связанной сущности (например, аукциона) |
| `relatedEntityType` | `RelatedEntityType` | Нет | Тип связанной сущности |
| `metadata` | `Record<string, any>` | Нет | Дополнительные метаданные (по умолчанию: {}) |
| `description` | `string` | Да | Описание транзакции для пользователя |
| `createdAt` | `Date` | Да | Дата создания |
| `updatedAt` | `Date` | Да | Дата последнего обновления |

### TransactionType (Enum)

| Значение | Описание |
|----------|----------|
| `BID` | Размещение новой ставки (блокировка средств) |
| `INCREASE_BID` | Повышение существующей ставки (блокировка разницы) |
| `TRANSFER` | Перевод средств между кошельками |

### RelatedEntityType (Enum)

| Значение | Описание |
|----------|----------|
| `AUCTION` | Транзакция связана с аукционом |

### Индексы

- `relatedEntityId + relatedEntityType` - для поиска всех транзакций по сущности

### Бизнес-логика

- Все финансовые операции регистрируются как транзакции
- Транзакции неизменяемы (не удаляются и не редактируются)
- `toWalletId = null` означает блокировку средств (BID, INCREASE_BID)
- `toWalletId != null` означает перевод между кошельками (TRANSFER)
- `metadata` может содержать дополнительную информацию (например, `bidId`, `itemId`)
