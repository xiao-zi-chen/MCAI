plugins { java }
group = "local.agx.prototype"
version = "0.1.0"
java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }
dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21-R0.1-SNAPSHOT")
    compileOnly("com.google.code.gson:gson:2.11.0")
    compileOnly(files("../runs/bedwars-local/plugins/BedWars-0.2.44.jar"))
}
tasks.compileJava { options.encoding = "UTF-8"; options.release.set(21) }
tasks.processResources { from("../competition/rules.json") { rename { "competition-rules.json" } } }
