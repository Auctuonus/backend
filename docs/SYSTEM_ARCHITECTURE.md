# Auctionus Backend - Архитектура системы

## Обзор

Auctionus - это backend-система для проведения онлайн-аукционов с авторизацией через Telegram. Система поддерживает многораундовые аукционы, anti-sniping механизм и безопасные финансовые транзакции.

## Технологический стек

- **Runtime**: Node.js
- **Framework**: NestJS 11
- **Database**: MongoDB (Mongoose ODM)
- **Cache/Locks**: Redis (cache-manager-redis-yet)
- **Message Queue**: RabbitMQ (delayed message exchange)
- **Authentication**: JWT + Telegram WebApp InitData

## Архитектура компонентов

```
┌─────────────────────────────────────────────────────────────────┐
│                        Клиент (Telegram WebApp)                  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Gateway                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Auth     │  │   Auction   │  │    Bids     │              │
│  │ Controller  │  │ Controller  │  │ Controller  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Business Logic Layer                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Auth      │  │   Auction   │  │   Bid Placement         │  │
│  │  Service    │  │  Service    │  │   Service               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│    MongoDB    │          │     Redis     │          │   RabbitMQ    │
│   (данные)    │          │ (кэш + локи)  │          │  (очередь)    │
└───────────────┘          └───────────────┘          └───────────────┘
                                                              │
                                                              ▼
                                                    ┌───────────────┐
                                                    │    Runner     │
                                                    │   (Consumer)  │
                                                    └───────────────┘
```

## Модули системы

### 1. Auth Module
- Авторизация через Telegram WebApp InitData
- Авторизация по паролю (для тестирования)
- JWT токены (access + refresh)
- Автоматическое создание пользователя и кошелька при первом входе

### 2. Auction Module
- Получение списка аукционов с фильтрацией и пагинацией
- Получение детальной информации об аукционе
- Кэширование ответов (5 минут)

### 3. Bid Module
- Размещение и повышение ставок
- Проверка баланса и минимальных требований
- Блокировка средств на кошельке
- Создание транзакций

### 4. Runner Module (Consumer)
- Обработка завершённых раундов аукционов
- Определение победителей
- Перевод средств и предметов
- Разблокировка средств проигравших

## Модели данных

### User
```typescript
{
  telegramId: number;      // ID пользователя в Telegram
  hashedPassword?: string; // Опциональный пароль
  createdAt: Date;
  updatedAt: Date;
}
```

### Wallet
```typescript
{
  userId: ObjectId;        // Ссылка на пользователя
  balance: number;         // Общий баланс (в минимальных единицах)
  lockedBalance: number;   // Заблокированный баланс (активные ставки)
  createdAt: Date;
  updatedAt: Date;
}
```

### Auction
```typescript
{
  name: string;
  status: 'active' | 'ended' | 'cancelled';
  sellerId: ObjectId;
  sellerWalletId: ObjectId;
  settings: {
    antisniping?: number;      // Секунды для продления
    minBid?: number;           // Минимальная ставка
    minBidDifference?: number; // Минимальный шаг ставки
  };
  rounds: [{
    startTime: Date;
    endTime: Date;
    status: 'active' | 'ended' | 'cancelled';
    itemIds: ObjectId[];
  }];
  createdAt: Date;
  updatedAt: Date;
}
```

### Bid
```typescript
{
  userId: ObjectId;
  auctionId: ObjectId;
  amount: number;
  status: 'active' | 'won' | 'lost';
  createdAt: Date;
  updatedAt: Date;
}
```

### Item
```typescript
{
  num: string;             // Номер предмета
  collectionName: string;  // Название коллекции
  value: string;           // Значение/описание
  ownerId: ObjectId;       // Текущий владелец
  createdAt: Date;
  updatedAt: Date;
}
```

### Transaction
```typescript
{
  fromWalletId: ObjectId;
  toWalletId?: ObjectId;
  amount: number;
  type: 'BID' | 'INCREASE_BID' | 'TRANSFER';
  relatedEntityId: ObjectId;
  relatedEntityType: 'AUCTION';
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Механизмы обеспечения консистентности

### 1. Distributed Locks (Redis)
Все операции записи защищены распределёнными локами:

- **`auction:{auctionId}`** - лок на аукцион при размещении ставки и обработке
- **`user:{userId}:bid`** - лок на пользователя при размещении ставки

Параметры локов:
- TTL: 10-60 секунд (в зависимости от операции)
- Retry: до 50 попыток с задержкой 100ms

### 2. MongoDB Transactions
Все операции изменения данных выполняются в транзакциях:
- Размещение ставки (bid + wallet + transaction)
- Обработка раунда (bids + items + wallets + transactions)

### 3. Idempotency
- Проверка статуса аукциона перед обработкой
- Проверка статуса раунда перед обработкой
- Nack с requeue=false для невалидных сообщений

## Обработка аукционов (RabbitMQ)

### Delayed Message Exchange
Используется `x-delayed-message` exchange для отложенной обработки:

```
Exchange: delayed.ex (type: x-delayed-message)
Queue: jobs.q
Routing Key: jobs
```

### Формат сообщения
```typescript
{
  id: string;           // UUID сообщения
  auctionId: string;    // ID аукциона
  publishedAt: Date;    // Время публикации
}
```

### Мониторинг времени
Система логирует:
- **Queue delay** - задержка между публикацией и обработкой
- **Processing time** - время обработки
- **Warning** при задержке > 5 секунд

## API Endpoints

### Auth
- `POST /auth/telegram` - авторизация через Telegram
- `POST /auth/password` - авторизация по паролю
- `POST /auth/refresh` - обновление токенов

### Users
- `POST /users/get_me` - получение текущего пользователя с кошельком

### Auctions
- `POST /auctions/get_list` - список аукционов
- `POST /auctions/get/:auction_id` - детали аукциона

### Bids
- `POST /bids/set_bid` - размещение/повышение ставки
- `POST /bids/get_my` - мои ставки
- `POST /bids/get_by_auction/:auction_id` - ставки по аукциону

---

# Продуктовые требования

## Пользователи
1. Авторизация через Telegram WebApp
2. Автоматическое создание кошелька при регистрации
3. Просмотр баланса (общий и свободный)

## Кошелёк
1. Единая валюта (целые числа - минимальные единицы)
2. Разделение на общий и заблокированный баланс
3. Журнал всех транзакций

## Аукционы (Продавец)
1. Выставление одного или нескольких предметов
2. Создание нескольких раундов
3. Настройки аукциона:
   - Минимальная ставка
   - Минимальный шаг ставки
   - Anti-sniping (продление времени при ставке в конце)
   - Время окончания раунда

## Аукционы (Покупатель)
1. Просмотр активных аукционов
2. Размещение и повышение ставок
3. Просмотр своих ставок и позиции в рейтинге
4. Автоматическая блокировка средств при ставке

## Обработка результатов
1. Автоматическое определение победителей
2. Перевод средств продавцу
3. Передача предметов победителям
4. Разблокировка средств проигравших

---

# Системные требования

## Производительность
- Время ответа API: < 200ms (p95)
- Время обработки ставки: < 500ms
- Задержка очереди RabbitMQ: < 5 секунд (warning)

## Надёжность
- Транзакционная консистентность данных
- Распределённые локи для предотвращения race conditions
- Retry механизм для RabbitMQ сообщений
- Graceful degradation при недоступности Redis

## Масштабируемость
- Горизонтальное масштабирование API серверов
- Единственный consumer для обработки аукционов (или с distributed locks)
- MongoDB replica set для отказоустойчивости

## Безопасность
- JWT токены с коротким временем жизни (15 минут)
- Refresh токены (7 дней)
- Валидация Telegram InitData
- Валидация всех входных данных (class-validator)

## Мониторинг
- Логирование времени обработки сообщений
- Warning при высокой задержке очереди
- Логирование ошибок транзакций

---

# Конфигурация

## Environment Variables
```env
PORT=3000
MONGODB_URL=mongodb://localhost:27017/auctionus
REDIS_HOST=localhost
REDIS_PORT=6379
RABBITMQ_URL=amqp://localhost:5672
TELEGRAM_BOT_TOKEN=your-bot-token
JWT_SECRET=your-secret-change-in-production
JWT_AUTH_EXPIRES_IN=900
JWT_REFRESH_TOKEN_EXPIRES_IN=604800
```

## Docker Compose
Система включает:
- MongoDB (replica set для транзакций)
- Redis
- RabbitMQ (с плагином delayed message)
- Backend API
- Runner (consumer)
