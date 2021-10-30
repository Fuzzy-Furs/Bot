import { GuildMember, Message, MessageAttachment, MessageEmbed, TextChannel } from "discord.js";
import moment from "moment";
import FuzzyClient from "../lib/FuzzyClient";
import { GuildRepo } from "../repositories/GuildRepository";
import BaseEvent from "../structures/BaseEvent";
import { channelResolver, messageResolver } from "../utils/resolvers";
import { VerificationRepo } from "../repositories/VerificationRepo";

export default class MemberCreateEvent extends BaseEvent {
    constructor(client: FuzzyClient) {
        super(client, {
            eventName: "messageCreate",
        });
    }
    async run(client: FuzzyClient, message: Message) {
        if (message.author.bot || client.user!.id === message.author.id) return;
        // Check if it was a dm, if so check if they have a verification question open
        const verifyRepo = client.database.getCustomRepository(VerificationRepo);
        const guildRepo = client.database.getCustomRepository(GuildRepo);
        if (message.channel.type == "DM") {
            const verify = await verifyRepo.findOne({ userID: message.author.id, questioning: true });
            if (verify) {
                const verifyingGuild = client.guilds.cache.get(verify.guildID);
                const questioningChannel = verifyingGuild!.channels.cache.get(verify.questionChannelID) as TextChannel;
                if (message.attachments) {
                    const files: MessageAttachment[] = [];
                    message.attachments.forEach((attachment) => {
                        files.push(attachment);
                    });
                    return await questioningChannel
                        .send({ content: `**${message.author} || (${message.author.id})**: ${message.content}`, files })
                        .then(() => message.react("✅"));
                } else {
                    return await questioningChannel
                        .send({ content: `**${message.author} || (${message.author.id})**: ${message.content}` })
                        .then(() => message.react("✅"));
                }
            }
        } else {
            const verify = await verifyRepo.findOne({ questionChannelID: message.channel.id, questioning: true });
            if (verify) {
                const guildData = await guildRepo.findOne({ guildID: message.guild?.id })!;
                if (!message.content.startsWith("//")) {
                    const verifyingUser = client.users.cache.get(verify.userID);
                    if (!verifyingUser) {
                        message.channel.send("User has left the server");
                        const questioningChannel = message.guild!.channels.cache.get(
                            verify.questionChannelID,
                        ) as TextChannel;
                        questioningChannel.delete();
                        verifyRepo.delete({ userID: verify.userID, guildID: message.guild!.id });
                        const pendingChannel = message.guild?.channels.cache.get(
                            guildData?.pendingVerficiatonChannelID!,
                        ) as TextChannel;
                        if (pendingChannel) {
                            pendingChannel.messages.fetch(verify.pendingVerificationID).then((msg) => {
                                msg.delete();
                            });
                        }
                        return;
                    }

                    if (message.content.startsWith("!!")) {
                        let data: string;
                        let buffer;
                        let messages;
                        const verifyingMember = message.guild?.members.cache.get(verifyingUser.id)!;
                        const pendingChannel = message.guild?.channels.cache.get(
                            guildData?.pendingVerficiatonChannelID!,
                        ) as TextChannel;
                        let pendingMsg = await pendingChannel.messages.fetch(verify.pendingVerificationID);
                        if (pendingMsg?.partial) {
                            pendingMsg.fetch();
                        }
                        let loggingChannel =
                            (await message.guild?.channels.cache.get(guildData!.verificationLogChannelID)) || null;
                        switch (message.content.slice(2).trim().split(/ +/g)[0]) {
                            case "ban":
                                const banReason = message.content.split(" ").slice(1).join(" ");
                                if (banReason) {
                                    verifyingMember.send(`You're banned from ${message.guild!.name} for ${banReason}`);
                                    verifyingMember.ban({
                                        reason: `Banned from verification in ${
                                            message.guild!.name
                                        } (For ServerProtector Users) for ${banReason}`,
                                    });
                                    const bannedmsg = await pendingMsg?.channel
                                        .send("User has been banned!")
                                        .catch(async (m) => {
                                            let unability = await m.channel.send("Unable to ban user!");
                                            setTimeout(() => unability!.delete(), 10000);
                                        });
                                    setTimeout(() => bannedmsg!.delete(), 10000);
                                    if (loggingChannel && loggingChannel?.isText()) {
                                        data = `ARCHIVE (cached messages only) of deleted text channel ${
                                            message.channel.name
                                        }, ID ${message.channel.id}\nCreated on ${moment(
                                            message.channel.createdAt,
                                        ).format()}\nDeleted on ${moment().format()}\n\n`;
                                        // Iterate through the messages, sorting by ID, and add them to data
                                        messages = message.channel.messages.cache;
                                        messages.toJSON().map((message) => {
                                            // Write each message to data
                                            data += `+++Message by ${message.author.username}#${message.author.discriminator} (${message.author.id}), ID ${message.id}+++\n`;
                                            data += `-Time: ${moment(message.createdAt).format()}\n`;
                                            // Write attachment URLs
                                            message.attachments.toJSON().map((attachment) => {
                                                data += `-Attachment: ${attachment.url}\n`;
                                            });
                                            // Write embeds as JSON
                                            message.embeds.map((embed) => {
                                                data += `-Embed: ${JSON.stringify(embed)}\n`;
                                            });
                                            // Write the clean version of the message content
                                            data += `${message.cleanContent}\n\n\n`;
                                        });

                                        // Create a buffer with the data
                                        buffer = Buffer.from(data, "utf-8");
                                        loggingChannel.send({
                                            embeds: [
                                                pendingMsg?.embeds[0]
                                                    .addField(`STATUS`, `DENIED/BANNED BY ${message.member}`)
                                                    .setDescription(`Deny Reason: ${banReason}`)
                                                    .setColor("RED")!,
                                            ],
                                            files: [{ attachment: buffer, name: `${message.channel.name}.txt` }],
                                        });
                                    }
                                    verifyRepo.delete({ userID: verify.userID, guildID: message.guild!.id });
                                    await message.channel.delete().catch((e) => {
                                        message.channel.send(`Unable to delete channel, here's why ${e}`);
                                    });
                                    pendingMsg!.delete();
                                } else {
                                    message.channel.send("Make sure you provide a reason for your bans").then((m) => {
                                        setTimeout(() => m.delete(), 1000 * 60 * 1);
                                    });
                                }
                                break;
                            case "kick":
                                const kickReason = message.content.split(" ").slice(1).join(" ");
                                if (kickReason) {
                                    verifyingMember.send(`You're kicked from ${message.guild!.name} for ${kickReason}`);
                                    verifyingMember.kick(`Kicked from verification for ${kickReason}`);
                                    const kickedmsg = await pendingMsg?.channel.send("User has been kicked!");
                                    setTimeout(() => kickedmsg!.delete(), 10000);
                                    if (loggingChannel && loggingChannel?.isText()) {
                                        data = `ARCHIVE (cached messages only) of deleted text channel ${
                                            message.channel.name
                                        }, ID ${message.channel.id}\nCreated on ${moment(
                                            message.channel.createdAt,
                                        ).format()}\nDeleted on ${moment().format()}\n\n`;
                                        // Iterate through the messages, sorting by ID, and add them to data
                                        messages = message.channel.messages.cache;
                                        messages.toJSON().map((message) => {
                                            // Write each message to data
                                            data += `+++Message by ${message.author.username}#${message.author.discriminator} (${message.author.id}), ID ${message.id}+++\n`;
                                            data += `-Time: ${moment(message.createdAt).format()}\n`;
                                            // Write attachment URLs
                                            message.attachments.toJSON().map((attachment) => {
                                                data += `-Attachment: ${attachment.url}\n`;
                                            });
                                            // Write embeds as JSON
                                            message.embeds.map((embed) => {
                                                data += `-Embed: ${JSON.stringify(embed)}\n`;
                                            });
                                            // Write the clean version of the message content
                                            data += `${message.cleanContent}\n\n\n`;
                                        });

                                        // Create a buffer with the data
                                        buffer = Buffer.from(data, "utf-8");
                                        loggingChannel.send({
                                            embeds: [
                                                pendingMsg?.embeds[0]
                                                    .addField(`STATUS`, `DENIED/KICKED BY ${message.member}`)
                                                    .setDescription(`Deny Reason: ${kickReason}`)
                                                    .setColor("RED")!,
                                            ],
                                            files: [{ attachment: buffer, name: `${message.channel.name}.txt` }],
                                        });
                                    }
                                    verifyRepo.delete({ userID: verify.userID, guildID: message.guild!.id });
                                    await message.channel.delete().catch((e) => {
                                        message.channel.send(`Unable to delete channel, here's why ${e}`);
                                    });
                                } else {
                                    message.channel.send("Make sure you provide a reason for your kick").then((m) => {
                                        setTimeout(() => m.delete(), 1000 * 60 * 1);
                                    });
                                }
                                pendingMsg!.delete();
                                break;
                            case "accept":
                                pendingMsg!.delete();
                                const r = message.guild?.roles.cache.get(guildData?.verifiedRoleID!);
                                if (!r) return;
                                verifyingMember.roles.add(r);
                                if (loggingChannel && loggingChannel?.isText()) {
                                    data = `ARCHIVE (cached messages only) of deleted text channel ${
                                        message.channel.name
                                    }, ID ${message.channel.id}\nCreated on ${moment(
                                        message.channel.createdAt,
                                    ).format()}\nDeleted on ${moment().format()}\n\n`;
                                    // Iterate through the messages, sorting by ID, and add them to data
                                    messages = message.channel.messages.cache;
                                    messages.toJSON().map((message) => {
                                        // Write each message to data
                                        data += `+++Message by ${message.author.username}#${message.author.discriminator} (${message.author.id}), ID ${message.id}+++\n`;
                                        data += `-Time: ${moment(message.createdAt).format()}\n`;
                                        // Write attachment URLs
                                        message.attachments.toJSON().map((attachment) => {
                                            data += `-Attachment: ${attachment.url}\n`;
                                        });
                                        // Write embeds as JSON
                                        message.embeds.map((embed) => {
                                            data += `-Embed: ${JSON.stringify(embed)}\n`;
                                        });
                                        // Write the clean version of the message content
                                        data += `${message.cleanContent}\n\n\n`;
                                    });

                                    // Create a buffer with the data
                                    buffer = Buffer.from(data, "utf-8");
                                    loggingChannel.send({
                                        embeds: [
                                            pendingMsg?.embeds[0]
                                                .addField(`STATUS`, `ACCEPTED BY ${message.member}`)
                                                .setColor("GREEN")!,
                                        ],
                                        files: [{ attachment: buffer, name: `${message.channel.name}.txt` }],
                                    });
                                }
                                if (guildData?.generalChannel) {
                                    await message.channel.delete().catch((e) => {
                                        message.channel.send(`Unable to delete channel, here's why ${e}`);
                                    });
                                    const generalChannel = message.guild?.channels.cache.get(guildData.generalChannel);
                                    if (!guildData.welcomeMessage || !generalChannel || !generalChannel?.isText())
                                        return;
                                    const welcomeMessage = guildData.welcomeMessage
                                        .replace("%member", `${verifyingMember}`)
                                        .replace("%guild", message.guild!.name);
                                    const embed = new MessageEmbed()
                                        .setAuthor(
                                            verifyingMember.user.tag,
                                            verifyingMember.user.displayAvatarURL({ dynamic: true }),
                                        )
                                        .setDescription(welcomeMessage)
                                        .setThumbnail(verifyingMember.user.displayAvatarURL({ dynamic: true }))
                                        .setColor("#ff1493")
                                        .setFooter(
                                            `If for some reason you need assistance feel free to make a ticket!`,
                                        );
                                    generalChannel.send({
                                        embeds: [embed],
                                        content: `${
                                            message.guild?.roles.cache.get(guildData.welcomeRoleID)
                                                ? message.guild?.roles.cache.get(guildData.welcomeRoleID)
                                                : "[*Welcome role was not set/deleted*]"
                                        } | ${verifyingMember}`,
                                    });
                                }
                                break;
                            case "deny":
                                const denyReason = message.content.split(" ").slice(1).join(" ");

                                if (denyReason) {
                                    if (loggingChannel && loggingChannel?.isText()) {
                                        data = `ARCHIVE (cached messages only) of deleted text channel ${
                                            message.channel.name
                                        }, ID ${message.channel.id}\nCreated on ${moment(
                                            message.channel.createdAt,
                                        ).format()}\nDeleted on ${moment().format()}\n\n`;
                                        // Iterate through the messages, sorting by ID, and add them to data
                                        messages = message.channel.messages.cache;
                                        messages.toJSON().map((message) => {
                                            // Write each message to data
                                            data += `+++Message by ${message.author.username}#${message.author.discriminator} (${message.author.id}), ID ${message.id}+++\n`;
                                            data += `-Time: ${moment(message.createdAt).format()}\n`;
                                            // Write attachment URLs
                                            message.attachments.toJSON().map((attachment) => {
                                                data += `-Attachment: ${attachment.url}\n`;
                                            });
                                            // Write embeds as JSON
                                            message.embeds.map((embed) => {
                                                data += `-Embed: ${JSON.stringify(embed)}\n`;
                                            });
                                            // Write the clean version of the message content
                                            data += `${message.cleanContent}\n\n\n`;
                                        });

                                        // Create a buffer with the data
                                        buffer = Buffer.from(data, "utf-8");
                                        loggingChannel.send({
                                            embeds: [
                                                pendingMsg?.embeds[0]
                                                    .addField(`STATUS`, `DENIED BY ${message.member}`)
                                                    .setDescription(`Deny Reason: ${denyReason}`)
                                                    .setColor("RED")!,
                                            ],
                                            files: [{ attachment: buffer, name: `${message.channel.name}.txt` }],
                                        });
                                    }
                                    const embed = new MessageEmbed()
                                        .setTitle("❌ You're Verification has been denied")
                                        .setAuthor(verifyingUser.tag, verifyingUser.displayAvatarURL({ dynamic: true }))
                                        .setColor("#ff1493")
                                        .setDescription(`Reason: ${denyReason}\nYou may redo the application`);
                                    verifyingUser.send({ embeds: [embed] });
                                    await message.channel.delete().catch((e) => {
                                        message.channel.send(`Unable to delete channel, here's why ${e}`);
                                    });
                                    pendingMsg!.delete();
                                } else {
                                    message.channel.send("Make sure you provide a reason for your deny").then((m) => {
                                        setTimeout(() => m.delete(), 1000 * 60 * 1);
                                    });
                                }
                                break;
                        }
                        return;
                    } else {
                        if (message.attachments) {
                            const files: MessageAttachment[] = [];
                            message.attachments.forEach((attachment) => {
                                files.push(attachment);
                            });

                            return verifyingUser
                                .send({ content: `**Staff Member**: ${message.content}`, files })
                                .then(() => {
                                    message.react("✅");
                                });
                        } else {
                            return verifyingUser.send({ content: `**Staff Member**: ${message.content}` }).then(() => {
                                message.react("✅");
                            });
                        }
                    }
                }
            }
        }
    }
}