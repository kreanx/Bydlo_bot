import {Telegraf, Scenes, session, Markup} from "telegraf"
import {MongoClient} from "mongodb"
import {scheduleJob} from "node-schedule"
import {v4 as uuidv4} from "uuid"
import * as dotenv from "dotenv"

interface UserProfile {
    telegramId: string
    username?: string
    firstName?: string
    lastName?: string
    age?: number
    city?: string
    stack?: string[]
    experienceMonths?: number
    salary?: number
    company?: string
    interests?: string[]
    lastExperienceUpdate?: Date
}

dotenv.config()

const bot = new Telegraf<Scenes.SceneContext>(process.env.BOT_TOKEN || "")

const mongoUrl = process.env.MONGO_URL || "mongodb://localhost:27017"
const client = new MongoClient(mongoUrl)
const dbName = "telegramBot"
let db: any

// Получение топ-10 популярных городов
async function getTopCities(): Promise<string[]> {
    try {
        const pipeline = [
            {$match: {city: {$exists: true, $ne: null}}},
            {$group: {_id: {$toLower: "$city"}, count: {$sum: 1}}},
            {$sort: {count: -1}},
            {$limit: 10},
            {$project: {_id: 1}},
        ]
        const result = await db
            .collection("users")
            .aggregate(pipeline)
            .toArray()
        const cities = result.map((item: any) => item._id)
        return cities
    } catch (error) {
        console.error("Error fetching top cities:", error)
        return []
    }
}

// Инициализация базы данных
async function initDb() {
    try {
        await client.connect()
        console.log("Connected to MongoDB")
        db = client.db(dbName)
        await db
            .collection("users")
            .updateMany({city: {$exists: true, $ne: null}}, [
                {$set: {city: {$toLower: "$city"}}},
            ])
        console.log("Normalized cities to lowercase")
    } catch (error) {
        console.error("MongoDB connection error:", error)
    }
}

bot.telegram.setMyCommands([
    {command: "start", description: "Начать регистрацию"},
    {
        command: "profile",
        description: "Просмотреть профиль (@username для чужого)",
    },
    {command: "update", description: "Обновить данные"},
    {command: "search", description: "Найти пользователей по городу"},
    {command: "stats", description: "Средняя зарплата"},
])

const registrationScene = new Scenes.WizardScene(
    "REGISTRATION_SCENE",
    async (ctx: any) => {
        await ctx.reply("Введите ваше имя (или /skip для пропуска):")
        ctx.wizard.state.profile = {
            telegramId: ctx.from.id.toString(),
            username: ctx.from.username,
        }
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            ctx.wizard.state.profile.firstName = ctx.message.text
        }
        await ctx.reply("Введите вашу фамилию (или /skip):")
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            const age = parseInt(ctx.message.text)
            if (isNaN(age) || age < 0 || age > 150) {
                await ctx.reply(
                    "Пожалуйста, введите корректный возраст (число от 0 до 100)."
                )
                return
            }
            ctx.wizard.state.profile.age = age
        }
        const topCities = await getTopCities()
        if (topCities.length > 0) {
            await ctx.reply(
                "Выберите город из списка или введите свой (или /skip):",
                Markup.keyboard(topCities.map((city) => [city]))
                    .oneTime()
                    .resize()
            )
        } else {
            await ctx.reply("В каком городе вы живете? (или /skip):")
        }
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            ctx.wizard.state.profile.city = ctx.message.text
                .trim()
                .toLowerCase()
        }
        await ctx.reply(
            "Какой у вас стек технологий? (через запятую, или /skip):",
            Markup.removeKeyboard()
        )
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            ctx.wizard.state.profile.stack = ctx.message.text
                .split(",")
                .map((s: string) => s.trim())
        }
        await ctx.reply("Какой у вас опыт работы (в месяцах)? (или /skip):")
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            const experienceMonths = parseInt(ctx.message.text)
            if (isNaN(experienceMonths) || experienceMonths < 0) {
                await ctx.reply(
                    "Пожалуйста, введите корректный опыт работы (число месяцев)."
                )
                return
            }
            ctx.wizard.state.profile.experienceMonths = experienceMonths
        }
        await ctx.reply("Какая у вас зарплата? (или /skip):")
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            const salary = parseInt(ctx.message.text)
            if (isNaN(salary) || salary < 0) {
                await ctx.reply(
                    "Пожалуйста, введите корректную зарплату (не отрицательное число)."
                )
                return
            }
            ctx.wizard.state.profile.salary = salary
        }
        await ctx.reply("В какой компании вы работаете? (или /skip):")
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            ctx.wizard.state.profile.company = ctx.message.text
        }
        await ctx.reply("Какие у вас интересы? (через запятую, или /skip):")
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (ctx.message?.text && ctx.message.text !== "/skip") {
            ctx.wizard.state.profile.interests = ctx.message.text
                .split(",")
                .map((s: string) => s.trim())
        }
        ctx.wizard.state.profile.lastExperienceUpdate = new Date()

        await db
            .collection("users")
            .updateOne(
                {telegramId: ctx.wizard.state.profile.telegramId},
                {$set: ctx.wizard.state.profile},
                {upsert: true}
            )

        await ctx.reply(
            "Регистрация завершена! Используйте /profile для просмотра данных."
        )
        return ctx.scene.leave()
    }
)

const searchScene = new Scenes.WizardScene(
    "SEARCH_SCENE",
    async (ctx: any) => {
        const topCities = await getTopCities()
        if (topCities.length > 0) {
            await ctx.reply(
                "Выберите город для поиска или введите свой:",
                Markup.keyboard(topCities.map((city) => [city]))
                    .oneTime()
                    .resize()
            )
        } else {
            await ctx.reply("Введите город для поиска:")
        }
        return ctx.wizard.next()
    },
    async (ctx: any) => {
        if (!ctx.message?.text) {
            await ctx.reply("Пожалуйста, введите название города.")
            return
        }
        const query = ctx.message.text.trim().toLowerCase()

        try {
            const users = await db
                .collection("users")
                .find({city: {$regex: `^${query}$`, $options: "i"}})
                .toArray()

            if (users.length === 0) {
                await ctx.reply(
                    `Пользователи в городе "${query}" не найдены.`,
                    Markup.removeKeyboard()
                )
            } else {
                await ctx.reply(
                    users
                        .map((u: UserProfile) => `@${u.username}: ${u.city}`)
                        .join("\n"),
                    Markup.removeKeyboard()
                )
            }
        } catch (error) {
            console.error("Error in search scene:", error)
            await ctx.reply("Произошла ошибка при поиске. Попробуйте позже.")
        }
        return ctx.scene.leave()
    }
)

const stage = new Scenes.Stage([registrationScene, searchScene])
bot.use(session())
bot.use(stage.middleware())

bot.start(async (ctx) => {
    const user = await db
        .collection("users")
        .findOne({telegramId: ctx.from.id.toString()})
    if (user) {
        await ctx.reply(
            "Вы уже зарегистрированы! Используйте /profile для просмотра или /update для обновления."
        )
    } else {
        await ctx.reply("Добро пожаловать! Давайте зарегистрируем вас.")
        ctx.scene.enter("REGISTRATION_SCENE")
    }
})

bot.command("profile", async (ctx) => {
    const args = ctx.message?.text.split(" ")
    const targetUsername = args?.[1]?.startsWith("@")
        ? args[1].slice(1)
        : ctx.from.username

    const user = await db
        .collection("users")
        .findOne({username: targetUsername})
    if (!user) {
        await ctx.reply("Пользователь не найден или не зарегистрирован.")
        return
    }

    const experienceYears = user.experienceMonths
        ? Math.round((user.experienceMonths / 12) * 10) / 10
        : 0

    const emptyPlaceholder = "-"

    const profileText = `
Профиль @${user.username || emptyPlaceholder}:
Имя: ${user.firstName || emptyPlaceholder}
Фамилия: ${user.lastName || emptyPlaceholder}
Возраст: ${user.age || emptyPlaceholder}
Город: ${user.city || emptyPlaceholder}
Стек: ${user.stack?.join(", ") || emptyPlaceholder}
Опыт работы: ${experienceYears} лет (${user.experienceMonths || 0} мес.)
Зарплата: ${user.salary || emptyPlaceholder}
Компания: ${user.company || emptyPlaceholder}
Интересы: ${user.interests?.join(", ") || emptyPlaceholder}
  `
    await ctx.reply(profileText)
})

bot.command("update", (ctx) => {
    ctx.scene.enter("REGISTRATION_SCENE")
})

bot.command("search", async (ctx) => {
    ctx.scene.enter("SEARCH_SCENE")
})

bot.command("stats", async (ctx) => {
    const userCount = await db.collection("users").countDocuments()
    const avgSalary = await db
        .collection("users")
        .aggregate([
            {$match: {salary: {$exists: true}}},
            {$group: {_id: null, avg: {$avg: "$salary"}}},
        ])
        .toArray()

    await ctx.reply(
        `Всего пользователей: ${userCount}\nСредняя зарплата: ${Math.round(
            avgSalary[0]?.avg || 0
        )} тысяч рублей`
    )
})

// Шедулер для обновления опыта работы (каждый месяц)
scheduleJob("0 0 1 * *", async () => {
    try {
        const users = await db
            .collection("users")
            .find({experienceMonths: {$exists: true}})
            .toArray()
        console.log("Scheduler: Processing users:", users.length)
        for (const user of users) {
            const lastUpdate = new Date(user.lastExperienceUpdate)
            const now = new Date()
            const monthsDiff =
                (now.getFullYear() - lastUpdate.getFullYear()) * 12 +
                now.getMonth() -
                lastUpdate.getMonth()

            if (monthsDiff >= 1) {
                await db.collection("users").updateOne(
                    {telegramId: user.telegramId},
                    {
                        $inc: {experienceMonths: monthsDiff},
                        $set: {lastExperienceUpdate: now},
                    }
                )
                console.log(`Updated experience for user ${user.telegramId}`)
            }
        }
    } catch (error) {
        console.error("Scheduler error:", error)
    }
})

async function startBot() {
    await initDb()
    bot.launch()
    console.log("Bot started")
}

startBot().catch(console.error)

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
