const nodemailer = require('nodemailer');
const config_module = require("./config")

/**
 * 创建发送邮件的代理
 */
let transport = nodemailer.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: {
        user: config_module.email_user, // 发送方邮箱地址
        pass: config_module.email_pass // 邮箱授权码或者密码
    }
});

/**
 * 发送邮件的函数
 * @param {*} mailOptions_ 发送邮件的参数
 * @returns 
 */
function SendMail(mailOptions_){
    return new Promise(function(resolve, reject){
        transport.sendMail(mailOptions_, function(error, info){
            if (error) {
                console.log(error);
                reject(error); // 发送失败传递给trycatch，如果没有trycatch就报错（trycatch在外层）
            } else {
                console.log('邮件已成功发送：' + info.response);
                resolve(info.response) // 发送成功消息给外层await赋值给send-res
            }
        });
    })
}

module.exports.SendMail = SendMail