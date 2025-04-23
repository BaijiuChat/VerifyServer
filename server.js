const grpc = require('@grpc/grpc-js')
const crypto = require('crypto');
const message_proto = require('./proto')
const const_module = require('./const')
const redis_module = require('./redis')
const emailModule = require ('./email')

function generateSixDigitCode() {
    return crypto.randomInt(0, 999999).toString().padStart(6, '0');
}

// call是请求，callback是回调函数，注意async
async function GetVerifyCode(call, callback) {
    console.log("GetVerifyCode is called, email is ", call.request.email)

    let query_res = await redis_module.QueryRedis(const_module.code_prefix+call.request.email);
    console.log("query res is ", query_res)

    //生成验证码
    try{
        const uniqueId = generateSixDigitCode();
        const redisKey = const_module.code_prefix+call.request.email;
        // 只是为了方便测试，过期时间设置为了15秒
        const bres = await redis_module.SetRedisExpire(redisKey, uniqueId, 300);
        if(!bres){
            console.log("set redis error is ", bres)
            callback(null, { 
                email: call.request.email,
                error: const_module.Errors.Exception
            }); 
            return
        }
        console.log(" 验证码是 ", uniqueId)
        let text_str = `您的验证码如下:\n<b><font size="6">${uniqueId}</font></b>\n使用该验证码验证您的邮箱并完成你的注册。\n验证码有效期为5分钟。\n如果您并没有请求验证码，请无视该邮件。\n\n白久无瑕团队敬上`;
        //发送邮件
        let mailOptions = {
            from: 'baijiuwuhu@163.com',
            to: call.request.email,
            subject: '白久Chat验证码',
            text: text_str,
        };
        // 调用email.js中的SendMail函数发送邮件
        // 利用await等待异步操作发送邮件完成，发完之后再往下走程序
        // 注意await必须在async函数中使用
        let send_res = await emailModule.SendMail(mailOptions);
        console.log("send res is ", send_res)

        callback(null, { 
            email: call.request.email,
            error: const_module.Errors.Success
        }); 
    }catch(error){
        console.log("Error in GetVerifyCode: ", error)
        // 这里的null指的是有没有发生底层的错误
        callback(null, { 
            email: call.request.email,
            error: const_module.Errors.Exception
        }); 
    }

}

function main() {
    var server = new grpc.Server()
    server.addService(message_proto.VerifyService.service, { GetVerifyCode: GetVerifyCode })
    server.bindAsync('127.0.0.1:50051', grpc.ServerCredentials.createInsecure(), (err, port) => {
        // server.start() 已经不需要，bindAsync会自动调用bindAsync
        if (err) {
            console.error("Server bind failed:", err);
            process.exit(1);
          }
          // server.start();
          console.log('gRPC server running on port', port);
        });
}

main()