const express = require("express")
const routesApi = require("./routes/indexApiRoutes").router;
const routes = require("./routes/index").router;
const routesProdTest = require("./routes/ProductsTest").router;
const randomsApi = require("./routes/apiRandoms").router;
const path = require("path")
const ChatContainer = require("./Contenedores/Chat")
const chat = require("./models/chatContainerModel")
const { contenedorProductos } = require("./controllers/apiController")
const { Server: IOServer } = require("socket.io");
const normalizeMensajes = require("../util/normalize")
const session = require("express-session")
const cookieParser = require("cookie-parser")
const MongoStore = require("connect-mongo")
const mongoose = require("mongoose");
const mongoConnection = require("./db/database").mongoConnection
const passport = require("passport")
const initializePassportConfig = require("./passportConfig")
const config = require("./config")
const os = require("os");
const cluster = require("cluster");
const compression = require("compression");
const logger = require("./logs/logger.js")

const app = express();
const port = config.port;

const mongoStoreOptions = { useNewUrlParser: true, useUnifiedTopology: true };

if (config.mode === "cluster" && cluster.isPrimary) {

    os.cpus().map(() => {
        cluster.fork();
    })

    cluster.on("exit", worker => {
        console.log(`Worker ${worker.process.pid} died. A new one is being created.`)
        cluster.fork();
    })

} else {

     /* compression */
     app.use(compression())

    /* post url encode */
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    /* serve static files */
    app.use(express.static(path.join(__dirname, "../public")))

    /* cookies / session */
    app.use(cookieParser())
    app.use(session({
        store: MongoStore.create({
            mongoUrl:
                config.mongoconnect,
            mongoStoreOptions,
        }),
        secret: config.sessionsecret,
        resave: true,
        saveUninitialized: true,
        cookie: {
            maxAge: 120000
        },
        rolling: true
    }))

    /* passport init */
    app.use(passport.initialize())
    app.use(passport.session())
    initializePassportConfig(passport)


    /* funcion auth para middleware */
    function auth(req, res, next) {
        if (req.isAuthenticated() || req.session.user) {
            next();
        } else {
            res.status(401).json({ status: 401, code: "no credentials" })
        }
    }

    /* routes main */
    app.use("/", routes)
    app.use("/api/randoms", auth, randomsApi)
    app.use("/api/productos", auth, routesApi)
    app.use("/api/productos-test", auth, routesProdTest)

    /* not found */
    app.use((req, res) => {
        res.status(404).json({ error404: "Ruta no encontrada" });
    })

    // error handler
    app.use(function (err, req, res, next) {
        res.status(500).json({
            error: err.message,
        });
    });



    mongoose.connect(mongoConnection).then(() => console.log("Conexi??n establecida con Mongo")).catch(error => console.log("error conectado a db: ", error));

    /* start server */
    const expressServer = app.listen(process.env.PORT || port, (err) => {
        if (!err) {
            console.log(`El servidor se inicio en el puerto ${port}. Modo: ${config.mode}`)
        } else {
            console.log(`Hubo un error al iniciar el servidor: `, err)
        }
    })

    const io = new IOServer(expressServer);

    io.on("connection", async socket => {
        console.log("Nuevo usuario conectado")

        const mensajes = await chat.getAll();
        
        const normalizedMensajes = normalizeMensajes(mensajes);

        socket.emit("server:items-test", { productos: [], mensajes: normalizedMensajes })


        socket.on("client: producto", async producto => {
            await contenedorProductos.save(producto);

            io.emit("server:producto", producto);
        })

        socket.on("client:mensaje", async mensajeEnvio => {
            const savedMessage = await chat.save(mensajeEnvio);
            io.emit("server:mensaje", savedMessage);
        })
    })
}